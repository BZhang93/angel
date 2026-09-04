import "server-only";
import { prisma } from "@/lib/prisma";
import type { ScanKind } from "@/generated/prisma/enums";

// Progress for long jobs. A mailbox scan runs for minutes; without this the
// page shows a spinner and the user cannot tell a slow scan from a stuck one.
//
// Deliberately fire-and-forget on failure: progress reporting must never be the
// thing that breaks a scan.

export async function startRun(userId: string, kind: ScanKind, step: string) {
  // One run at a time per kind: an older row left RUNNING by a crashed or
  // abandoned request would otherwise poll forever.
  await prisma.scanRun.updateMany({
    where: { userId, kind, state: "RUNNING" },
    data: { state: "FAILED", message: "Superseded by a newer run.", finishedAt: new Date() },
  });

  return prisma.scanRun.create({ data: { userId, kind, step } });
}

export async function updateRun(
  runId: string | undefined,
  data: { step?: string; totalItems?: number; doneItems?: number; produced?: number },
): Promise<void> {
  if (!runId) return;
  try {
    await prisma.scanRun.update({ where: { id: runId }, data });
  } catch {
    // Progress is decoration; losing it must not fail the work.
  }
}

export async function bumpRun(
  runId: string | undefined,
  data: { doneItems?: number; produced?: number; step?: string },
): Promise<void> {
  if (!runId) return;
  try {
    await prisma.scanRun.update({
      where: { id: runId },
      data: {
        step: data.step,
        doneItems: data.doneItems ? { increment: data.doneItems } : undefined,
        produced: data.produced ? { increment: data.produced } : undefined,
      },
    });
  } catch {
    // As above.
  }
}

export async function finishRun(runId: string | undefined, message: string): Promise<void> {
  if (!runId) return;
  try {
    await prisma.scanRun.update({
      where: { id: runId },
      data: { state: "DONE", message, finishedAt: new Date() },
    });
  } catch {
    // As above.
  }
}

export async function failRun(runId: string | undefined, message: string): Promise<void> {
  if (!runId) return;
  try {
    await prisma.scanRun.update({
      where: { id: runId },
      data: { state: "FAILED", message, finishedAt: new Date() },
    });
  } catch {
    // As above.
  }
}

/// The most recent run of a kind, for the page to render. A run still RUNNING
/// is what tells the client to keep polling.
export async function latestRun(userId: string, kind: ScanKind) {
  return prisma.scanRun.findFirst({
    where: { userId, kind },
    orderBy: { startedAt: "desc" },
  });
}
