"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUserId } from "@/lib/session";
import { scanForCompanies } from "@/lib/import/scan";
import { failRun, finishRun, startRun, updateRun } from "@/lib/progress";
import { acceptCandidate } from "@/lib/import/accept";
import { rematchPendingUpdates } from "@/lib/gmail/rematch";
import { extractPendingUpdates } from "@/lib/extract/apply";
import { extractFromUpdate } from "@/lib/extract/update";
import { recordWireInstructionFees } from "@/lib/import/wire-fees";

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
async function fileMailFor(
  userId: string,
): Promise<{ filed: number; extracted: number; fees: number }> {
  const rematch = await rematchPendingUpdates(userId);

  // The fee pass runs whether or not anything was newly filed. A company
  // imported from a proposal already has its position, and the wire
  // instructions stating its fee may have been filed by an earlier run.
  if (rematch.matched === 0) {
    const fees = await recordWireInstructionFees(userId);
    return { filed: 0, extracted: 0, fees: fees.feesRecorded };
  }

  // Tracked as a run so the page can show what it is doing: extraction is model
  // calls, and a button that sits silent for minutes looks broken.
  const run = await startRun(userId, "SYNC", `Reading ${rematch.matched} newly filed emails`);
  try {
    const extraction = await extractPendingUpdates(userId, extractFromUpdate, { limit: 60 });
    const fees = await recordWireInstructionFees(userId);
    await finishRun(run.id, `Read ${extraction.extracted} emails.`);
    return { filed: rematch.matched, extracted: extraction.extracted, fees: fees.feesRecorded };
  } catch (error) {
    await failRun(run.id, error instanceof Error ? error.message : "Extraction failed.");
    return { filed: rematch.matched, extracted: 0, fees: 0 };
  }
}

/// Reads as "and 2 fees" when there are any, and as nothing when there are not.
function feeSuffix(fees: number): string {
  return fees > 0 ? ` Recorded ${fees} fee${fees === 1 ? "" : "s"} from wire instructions.` : "";
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

  if (filed.filed === 0 && filed.fees === 0) return undefined;

  return {
    status: "ok",
    message: filed.filed
      ? `Imported, and filed ${filed.filed} email${filed.filed === 1 ? "" : "s"} against your companies (${filed.extracted} read).${feeSuffix(filed.fees)}`
      : `Imported.${feeSuffix(filed.fees)}`,
  };
}

/// Bulk accept. Anything that fails is reported by count rather than aborting
/// the rest: a partial import is more useful than none.
export async function importAll(): Promise<ImportResult> {
  const userId = await requireUserId();
  const candidates = await prisma.importCandidate.findMany({
    where: { userId, state: "PROPOSED" },
    select: { id: true },
  });

  const run = await startRun(userId, "IMPORT_SCAN", `Importing ${candidates.length} companies`);
  let imported = 0;
  let failed = 0;

  for (const [index, candidate] of candidates.entries()) {
    const result = await acceptCandidate(userId, candidate.id);
    if ("error" in result) failed += 1;
    else imported += 1;
    await updateRun(run.id, {
      step: `Imported ${imported} of ${candidates.length}`,
      totalItems: candidates.length,
      doneItems: index + 1,
    });
  }

  await updateRun(run.id, { step: "Filing the emails behind them" });

  const filed = await fileMailFor(userId);
  await finishRun(run.id, `Imported ${imported} companies.`);
  revalidatePath("/", "layout");

  return {
    status: "ok",
    message: `Imported ${imported} compan${imported === 1 ? "y" : "ies"}${failed ? `, ${failed} could not be imported` : ""}.${filed.filed ? ` Filed ${filed.filed} email${filed.filed === 1 ? "" : "s"} against them and read ${filed.extracted}.` : ""}${feeSuffix(filed.fees)}`,
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
