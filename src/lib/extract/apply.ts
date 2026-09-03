import "server-only";
import { prisma } from "@/lib/prisma";
import type { Extraction } from "./schema";

// Writing an extraction back to the database.
//
// The provenance contract (prisma/schema.prisma) in one place: rows a human has
// touched are never replaced. Re-running extraction on an update refreshes the
// machine-written rows and leaves every corrected value alone.
export async function applyExtraction(
  userId: string,
  updateId: string,
  companyId: string,
  extraction: Extraction,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.updateMetric.deleteMany({ where: { updateId, editedByUser: false } });
    await tx.signal.deleteMany({ where: { updateId, editedByUser: false } });
    await tx.actionItem.deleteMany({ where: { updateId, editedByUser: false, state: "OPEN" } });

    await tx.updateMetric.createMany({
      data: extraction.metrics.map((metric) => ({
        updateId,
        key: metric.key,
        value: metric.value,
        unit: metric.unit,
        periodLabel: metric.periodLabel,
        sourceQuote: metric.sourceQuote,
        confidence: metric.confidence,
      })),
    });

    await tx.signal.createMany({
      data: extraction.signals.map((signal) => ({
        userId,
        companyId,
        updateId,
        kind: signal.kind,
        severity: signal.severity,
        summary: signal.summary,
        sourceQuote: signal.sourceQuote,
        confidence: signal.confidence,
        derived: false,
      })),
    });

    await tx.actionItem.createMany({
      data: extraction.actionItems.map((item) => ({
        userId,
        companyId,
        updateId,
        kind: item.kind,
        title: item.title,
        detail: item.detail,
        dueDate: parseDate(item.dueDate),
        sourceQuote: item.sourceQuote,
      })),
    });

    await tx.update.update({
      where: { id: updateId },
      data: { summary: extraction.summary, extractedAt: new Date() },
    });
  });
}

function parseDate(value: string | null): Date | null {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

/// Runs extraction over every confirmed, matched update that has not been
/// extracted yet. Called after a sync and from the Settings page.
export async function extractPendingUpdates(
  userId: string,
  runner: (input: {
    companyName?: string | null;
    subject?: string | null;
    receivedAt: Date;
    text: string;
  }) => Promise<Extraction>,
  opts: { limit?: number } = {},
): Promise<{ extracted: number; failed: number }> {
  const updates = await prisma.update.findMany({
    where: { userId, reviewState: "CONFIRMED", companyId: { not: null }, extractedAt: null },
    include: { company: { select: { name: true } } },
    orderBy: { receivedAt: "desc" },
    take: opts.limit ?? 25,
  });

  let extracted = 0;
  let failed = 0;

  for (const update of updates) {
    try {
      const result = await runner({
        companyName: update.company?.name,
        subject: update.subject,
        receivedAt: update.receivedAt,
        text: update.rawText,
      });
      await applyExtraction(userId, update.id, update.companyId!, result);
      extracted += 1;
    } catch {
      // One unreadable email must not stop the batch; it stays unextracted and
      // will be retried on the next run.
      failed += 1;
    }
  }

  return { extracted, failed };
}
