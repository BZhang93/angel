"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUserId } from "@/lib/session";
import { extractFromUpdate } from "@/lib/extract/update";
import { applyExtraction, extractPendingUpdates } from "@/lib/extract/apply";
import { extractPendingDocuments } from "@/lib/extract/apply-document";
import { syncGmail } from "@/lib/gmail/sync";
import { scanCompanyUpdates } from "@/lib/gmail/refresh";

export type UpdateActionResult = { status: "error"; message: string } | { status: "ok"; message: string } | void;

/// Assigns a pending update to a company and immediately extracts it, so the
/// review queue is one click rather than two screens.
export async function confirmUpdate(form: FormData): Promise<UpdateActionResult> {
  const userId = await requireUserId();
  const updateId = String(form.get("updateId") ?? "");
  const companyId = String(form.get("companyId") ?? "");
  if (!companyId) return { status: "error", message: "Choose a company first." };

  const [update, company] = await Promise.all([
    prisma.update.findFirst({ where: { id: updateId, userId } }),
    prisma.company.findFirst({ where: { id: companyId, userId } }),
  ]);
  if (!update || !company) return { status: "error", message: "Update or company not found." };

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
    await applyExtraction(userId, updateId, companyId, extraction);
  } catch (error) {
    // The assignment stands even if extraction fails; it retries on the next run.
    const message = error instanceof Error ? error.message : "Extraction failed.";
    revalidatePath("/", "layout");
    return { status: "error", message: `Assigned, but extraction failed: ${message}` };
  }

  revalidatePath("/", "layout");
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
  const syncQuery = String(form.get("syncQuery") ?? "").trim();
  if (!syncQuery) return { status: "error", message: "A Gmail query is required." };

  const updated = await prisma.gmailAccount.updateMany({ where: { userId }, data: { syncQuery } });
  if (updated.count === 0) return { status: "error", message: "Connect Gmail first." };

  try {
    const sync = await syncGmail(userId);
    const extraction = await extractPendingUpdates(userId, extractFromUpdate);
    const documents = await extractPendingDocuments(userId);
    revalidatePath("/", "layout");
    return {
      status: "ok",
      message: [
        `${sync.created} new (${sync.autoMatched} auto-matched, ${sync.pending} awaiting review).`,
        `Extracted ${extraction.extracted} update${extraction.extracted === 1 ? "" : "s"}${extraction.failed ? `, ${extraction.failed} failed` : ""}.`,
        sync.documents > 0 || documents.extracted > 0
          ? `${sync.documents} document${sync.documents === 1 ? "" : "s"} stored, ${documents.extracted} read, ${documents.filled} position${documents.filled === 1 ? "" : "s"} completed from them.`
          : null,
      ]
        .filter((part) => part !== null)
        .join(" "),
    };
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : "Sync failed." };
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
    if (scan.companies === 0) {
      return { status: "error", message: "No companies to scan for yet." };
    }

    const extraction = await extractPendingUpdates(userId, extractFromUpdate, { limit: 40 });
    const documents = await extractPendingDocuments(userId);
    revalidatePath("/", "layout");

    return {
      status: "ok",
      message: [
        `Searched mail from ${scan.companies} compan${scan.companies === 1 ? "y" : "ies"}:`,
        `${scan.created} new update${scan.created === 1 ? "" : "s"} of ${scan.found} matched,`,
        `${extraction.extracted} extracted${scan.documents ? `, ${scan.documents} document${scan.documents === 1 ? "" : "s"} stored` : ""}${documents.filled ? `, ${documents.filled} position${documents.filled === 1 ? "" : "s"} completed` : ""}.`,
      ].join(" "),
    };
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : "Scan failed." };
  }
}
