"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUserId } from "@/lib/session";
import { extractFromUpdate } from "@/lib/extract/update";
import { applyExtraction, extractPendingUpdates } from "@/lib/extract/apply";
import { mapWithConcurrency } from "@/lib/concurrency";
import { extractPendingDocuments } from "@/lib/extract/apply-document";
import { fetchPendingLinks } from "@/lib/enrich/links";
import { enrichCompanyProfiles } from "@/lib/enrich/company";
import { syncDocusign } from "@/lib/docusign/sync";
import { rematchPendingUpdates } from "@/lib/gmail/rematch";
import { ensureWatch, runIngestPipeline } from "@/lib/gmail/pipeline";
import { scanCompanyUpdates } from "@/lib/gmail/refresh";
import { syncErrorMessage } from "@/lib/gmail/auth-error";
import { extractionErrorMessage } from "@/lib/ai/errors";

export type UpdateActionResult = { status: "error"; message: string } | { status: "ok"; message: string } | void;

/// Assigns a pending update to a company and immediately extracts it, so the
/// review queue is one click rather than two screens.
export async function confirmUpdate(form: FormData): Promise<UpdateActionResult> {
  const userId = await requireUserId();
  const updateId = String(form.get("updateId") ?? "");
  const companyId = String(form.get("companyId") ?? "");
  if (!companyId) return { status: "error", message: "Choose a company first." };

  // Scoped to what is still pending, as the bulk path already was. The failure
  // path deliberately leaves the row on screen so its error stays readable, so
  // a second click is likely rather than theoretical, and a row already filed
  // should say so rather than quietly do the work again.
  const [update, company] = await Promise.all([
    prisma.update.findFirst({ where: { id: updateId, userId, reviewState: "PENDING" } }),
    prisma.company.findFirst({ where: { id: companyId, userId } }),
  ]);
  if (!company) return { status: "error", message: "Company not found." };
  if (!update) {
    return { status: "error", message: "Already filed. Reload to see where it went." };
  }

  await prisma.update.update({
    where: { id: updateId },
    data: { companyId, reviewState: "CONFIRMED" },
  });

  try {
    const extraction = await extractFromUpdate({
      companyName: company.name,
      subject: update.subject,
      receivedAt: update.receivedAt,
      text: update.rawText,
    });
    await applyExtraction(userId, updateId, companyId, extraction, {
      subject: update.subject,
      rawText: update.rawText,
    });
  } catch (error) {
    // The assignment stands even if extraction fails; it retries on the next run.
    //
    // Deliberately no revalidatePath here. Revalidating re-renders the queue,
    // the row is no longer pending so it leaves, and the component holding this
    // message unmounts with it: the one explanation of the failure flashes and
    // is gone. The write is already committed, so a queue that stays until the
    // next navigation costs nothing and keeps the message readable.
    return {
      status: "error",
      message: `Assigned, but not read. ${extractionErrorMessage(error)}`,
    };
  }

  revalidatePath("/", "layout");
}

/// Assigns several pending updates to one company at once.
///
/// The queue's shape is why this exists: a syndicate sends eight emails about
/// one deal and every one of them was a separate company pick. Extraction runs
/// concurrently under the same ceiling as a sync, because sequentially eight
/// model calls is a button that looks broken.
///
/// Not a FormData action. The checkboxes live inside a group that already
/// contains a form per row, and forms cannot nest, so selection is held in the
/// client and passed directly.
export async function confirmUpdates(
  updateIds: string[],
  companyId: string,
): Promise<UpdateActionResult> {
  const userId = await requireUserId();
  if (updateIds.length === 0) return { status: "error", message: "Select an update first." };

  const company = await prisma.company.findFirst({ where: { id: companyId, userId } });
  if (!company) return { status: "error", message: "Company not found." };

  // Scoped to this user and to what is genuinely still pending, so a stale page
  // cannot reassign something already dealt with.
  const updates = await prisma.update.findMany({
    where: { id: { in: updateIds }, userId, reviewState: "PENDING" },
  });
  if (updates.length === 0) return { status: "error", message: "Nothing left to assign." };

  await prisma.update.updateMany({
    where: { id: { in: updates.map((update) => update.id) }, userId },
    data: { companyId, reviewState: "CONFIRMED" },
  });

  const results = await mapWithConcurrency(updates, async (update) => {
    const extraction = await extractFromUpdate({
      companyName: company.name,
      subject: update.subject,
      receivedAt: update.receivedAt,
      text: update.rawText,
    });
    await applyExtraction(userId, update.id, companyId, extraction, {
      subject: update.subject,
      rawText: update.rawText,
    });
  });

  // The assignment stands whatever extraction did: a failed read is retried on
  // the next sync, and saying so beats reporting a clean success.
  const extracted = results.filter((result) => result.status === "fulfilled").length;
  const failures = results.filter(
    (result): result is PromiseRejectedResult => result.status === "rejected",
  );

  // Why they failed, not just how many. One cause is the usual case, so the
  // first rejection speaks for the batch rather than being swallowed.
  const reason =
    failures.length > 0 ? ` ${extractionErrorMessage(failures[0]!.reason)}` : "";

  revalidatePath("/", "layout");
  return {
    status: failures.length > 0 ? "error" : "ok",
    message: `Assigned ${updates.length} update${updates.length === 1 ? "" : "s"} to ${company.name}, ${extracted} read${failures.length ? `, ${failures.length} could not be read` : ""}.${reason}`,
  };
}

export async function rejectUpdate(form: FormData): Promise<void> {
  const userId = await requireUserId();
  const updateId = String(form.get("updateId") ?? "");

  const updated = await prisma.update.updateMany({
    where: { id: updateId, userId },
    data: { reviewState: "REJECTED" },
  });
  if (updated.count === 0) throw new Error("Update not found.");

  revalidatePath("/", "layout");
}

/// Syncs whatever query is in the box, saving it first. One button rather than
/// save-then-sync: a query you can see but have not saved is a trap.
export async function runSync(form: FormData): Promise<UpdateActionResult> {
  const userId = await requireUserId();
  // An empty query is now a real choice rather than an error: the company scan
  // and discovery both work without one, and insisting on a label is exactly
  // the manual filing this removes.
  const syncQuery = String(form.get("syncQuery") ?? "").trim();

  const updated = await prisma.gmailAccount.updateMany({ where: { userId }, data: { syncQuery } });
  if (updated.count === 0) return { status: "error", message: "Connect Gmail first." };

  try {
    // The shared pipeline rather than a copy of it. This button used to run its
    // own sequence, which is how it came to miss the company scan, the wire
    // fees and discovery: three steps the cron did and the button did not.
    const run = await runIngestPipeline(userId);
    revalidatePath("/", "layout");
    return {
      // An error only when nothing at all could be read. A credential that
      // died fails every call and must be loud; one email the model will never
      // parse fails forever and must not redden every run after it, because an
      // alarm that is always on is an alarm nobody reads.
      status: run.extractionError && run.extracted === 0 ? "error" : "ok",
      message: [
        `${run.created} new (${run.unlabelled} you never labelled, ${run.pending} awaiting review).`,
        run.refused > 0 ? `${run.refused} searched and left alone.` : null,
        // Silence here is what hid the backlog: a capped first pass reported a
        // tidy number and gave no hint that older mail was still unread.
        run.backfilled ? null : "Still working backwards through older mail; sync again to continue.",
        run.filed > 0 ? `${run.filed} previously unmatched email${run.filed === 1 ? "" : "s"} filed.` : null,
        `Extracted ${run.extracted} update${run.extracted === 1 ? "" : "s"}.`,
        run.documents > 0 ? `${run.documents} attachment${run.documents === 1 ? "" : "s"} read.` : null,
        run.fees > 0 ? `${run.fees} fee${run.fees === 1 ? "" : "s"} taken from wire instructions.` : null,
        run.extractionError ?? null,
      ]
        .filter((part) => part !== null)
        .join(" "),
    };
  } catch (error) {
    return { status: "error", message: syncErrorMessage(error) };
  }
}


/// Searches by sender rather than by label, so an update from a portfolio
/// company that was never filed under the sync label is still found. Optionally
/// scoped to one company.
export async function scanForUpdates(form: FormData): Promise<UpdateActionResult> {
  const userId = await requireUserId();
  const companyId = String(form.get("companyId") ?? "").trim() || undefined;

  try {
    const scan = await scanCompanyUpdates(userId, { companyId });
    const rematch = await rematchPendingUpdates(userId);
    if (scan.companies === 0) {
      return { status: "error", message: "No companies to scan for yet." };
    }

    const links = await fetchPendingLinks(userId, { companyId });
    const extraction = await extractPendingUpdates(userId, extractFromUpdate, { limit: 40 });
    const documents = await extractPendingDocuments(userId);
    await enrichCompanyProfiles(userId, { companyId });
    revalidatePath("/", "layout");

    return {
      status: "ok",
      message: [
        `Searched mail from ${scan.companies} compan${scan.companies === 1 ? "y" : "ies"}:`,
        `${scan.created} new update${scan.created === 1 ? "" : "s"} of ${scan.found} matched${rematch.matched ? `, ${rematch.matched} previously unmatched filed` : ""},`,
        `${extraction.extracted} extracted${scan.documents ? `, ${scan.documents} attachment${scan.documents === 1 ? "" : "s"} stored` : ""}${links.fetched ? `, ${links.fetched} linked page${links.fetched === 1 ? "" : "s"} read` : ""}${documents.filled ? `, ${documents.filled} position${documents.filled === 1 ? "" : "s"} completed` : ""}.`,
      ].join(" "),
    };
  } catch (error) {
    return { status: "error", message: syncErrorMessage(error, "Scan failed.") };
  }
}

/// Pulls completed envelopes from DocuSign and reads their terms. Independent
/// of email: whether a completion email carries the PDF is an account setting,
/// and the envelope is the authoritative copy either way.
export async function runDocusignSync(): Promise<UpdateActionResult> {
  const userId = await requireUserId();

  try {
    const sync = await syncDocusign(userId);
    const documents = await extractPendingDocuments(userId, { limit: 40 });
    revalidatePath("/", "layout");

    return {
      status: "ok",
      message: `${sync.envelopes} completed envelope${sync.envelopes === 1 ? "" : "s"}: ${sync.stored} stored, ${sync.matched} matched to a company, ${documents.extracted} read, ${documents.filled} position${documents.filled === 1 ? "" : "s"} completed from them.${sync.failed ? ` ${sync.failed} could not be downloaded.` : ""}`,
    };
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : "DocuSign sync failed.",
    };
  }
}

/// Turns discovery of unlabelled mail on or off. Separate from auto-sync
/// because it governs what is read rather than when: a user may well want the
/// hourly run without it reaching past the label they maintain by hand.
export async function setAutoDiscover(form: FormData): Promise<UpdateActionResult> {
  const userId = await requireUserId();
  const enabled = String(form.get("enabled") ?? "") === "true";

  const updated = await prisma.gmailAccount.updateMany({
    where: { userId },
    data: { autoDiscover: enabled },
  });
  if (updated.count === 0) return { status: "error", message: "Connect Gmail first." };

  revalidatePath("/settings");
  return {
    status: "ok",
    message: enabled
      ? "On. The next sync will also look for investment mail you never labelled."
      : "Off. Only your query and the portfolio's own senders are read now.",
  };
}

/// Turns automatic syncing on or off.
///
/// Two mechanisms serve it. With a Pub/Sub topic configured, Gmail pushes a
/// notification the moment mail arrives and the whole pipeline runs. Without
/// one, the hourly scheduled run does the same work. Google cannot push to a
/// laptop, so local development always uses the second.
export async function setAutoSync(form: FormData): Promise<UpdateActionResult> {
  const userId = await requireUserId();
  const enabled = String(form.get("enabled") ?? "") === "true";

  const updated = await prisma.gmailAccount.updateMany({
    where: { userId },
    data: { autoSync: enabled, ...(enabled ? {} : { watchExpiresAt: null }) },
  });
  if (updated.count === 0) return { status: "error", message: "Connect Gmail first." };

  if (!enabled) {
    revalidatePath("/settings");
    return { status: "ok", message: "Auto-sync off. Use Sync Now when you want an update." };
  }

  const watch = await ensureWatch(userId).catch((error: unknown) => ({
    watching: false,
    reason: syncErrorMessage(error, "Could not register the Gmail watch."),
  }));

  revalidatePath("/settings");
  return {
    status: "ok",
    message: watch.watching
      ? "Auto-sync on. Gmail will push new mail as it arrives, and the hourly run is the backstop."
      : `Auto-sync on, polling hourly. ${watch.reason ?? ""}`.trim(),
  };
}
