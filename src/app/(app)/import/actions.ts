"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUserId } from "@/lib/session";
import { scanForCompanies } from "@/lib/import/scan";
import { failRun, finishRun, startRun } from "@/lib/progress";
import { acceptCandidate } from "@/lib/import/accept";
import { rematchPendingUpdates } from "@/lib/gmail/rematch";
import { extractPendingUpdates } from "@/lib/extract/apply";
import { extractFromUpdate } from "@/lib/extract/update";

export type ImportResult =
  | { status: "error"; message: string }
  | { status: "ok"; message: string }
  | void;

export async function runScan(form: FormData): Promise<ImportResult> {
  const userId = await requireUserId();
  const query = String(form.get("query") ?? "").trim();

  // The run row is what the page polls: proposals are written as each sender is
  // reviewed, so they appear while the scan is still going.
  const run = await startRun(userId, "IMPORT_SCAN", "Starting");

  try {
    const result = await scanForCompanies(userId, { query: query || undefined, runId: run.id });
    const message = `Read ${result.scanned} emails across ${result.domains} senders. ${result.proposed} proposed, ${result.skipped} not investments${result.unchanged ? `, ${result.unchanged} sender${result.unchanged === 1 ? "" : "s"} unchanged since the last scan` : ""}.`;
    await finishRun(run.id, message);
    revalidatePath("/import");
    return { status: "ok", message };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Scan failed.";
    await failRun(run.id, message);
    revalidatePath("/import");
    return { status: "error", message };
  }
}

/// After a company exists, the mail about it can finally be filed and read.
/// This is what closes the loop between the two halves of the flow: import
/// creates the company, and the emails that proved it becomes its history.
async function fileMailFor(userId: string): Promise<{ filed: number; extracted: number }> {
  const rematch = await rematchPendingUpdates(userId);
  if (rematch.matched === 0) return { filed: 0, extracted: 0 };

  const extraction = await extractPendingUpdates(userId, extractFromUpdate, { limit: 60 });
  return { filed: rematch.matched, extracted: extraction.extracted };
}

export async function importCandidate(form: FormData): Promise<ImportResult> {
  const userId = await requireUserId();
  const id = String(form.get("id") ?? "");
  const name = String(form.get("name") ?? "").trim();
  const website = String(form.get("website") ?? "").trim();
  const sector = String(form.get("sector") ?? "").trim();

  const result = await acceptCandidate(userId, id, {
    name: name || undefined,
    website: website || null,
    sector: sector || null,
  });
  if ("error" in result) return { status: "error", message: result.error };

  const filed = await fileMailFor(userId);
  revalidatePath("/", "layout");

  return filed.filed > 0
    ? {
        status: "ok",
        message: `Imported, and filed ${filed.filed} email${filed.filed === 1 ? "" : "s"} against your companies (${filed.extracted} read).`,
      }
    : undefined;
}

/// Bulk accept. Anything that fails is reported by count rather than aborting
/// the rest: a partial import is more useful than none.
export async function importAll(): Promise<ImportResult> {
  const userId = await requireUserId();
  const candidates = await prisma.importCandidate.findMany({
    where: { userId, state: "PROPOSED" },
    select: { id: true },
  });

  let imported = 0;
  let failed = 0;
  for (const candidate of candidates) {
    const result = await acceptCandidate(userId, candidate.id);
    if ("error" in result) failed += 1;
    else imported += 1;
  }

  const filed = await fileMailFor(userId);
  revalidatePath("/", "layout");

  return {
    status: "ok",
    message: `Imported ${imported} compan${imported === 1 ? "y" : "ies"}${failed ? `, ${failed} could not be imported` : ""}.${filed.filed ? ` Filed ${filed.filed} email${filed.filed === 1 ? "" : "s"} against them and read ${filed.extracted}.` : ""}`,
  };
}

export async function dismissCandidate(form: FormData): Promise<void> {
  const userId = await requireUserId();
  const id = String(form.get("id") ?? "");

  const updated = await prisma.importCandidate.updateMany({
    where: { id, userId },
    data: { state: "DISMISSED" },
  });
  if (updated.count === 0) throw new Error("Candidate not found.");

  revalidatePath("/import");
}
