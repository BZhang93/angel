import "server-only";
import { prisma } from "@/lib/prisma";
import { linkedTextForUpdate } from "@/lib/enrich/links";
import { mapWithConcurrency } from "@/lib/concurrency";
import { recordPayment } from "./payments";
import type { Extraction } from "./schema";
import { parseWireTable } from "@/lib/import/wire-table";

// Writing an extraction back to the database.
//
// The provenance contract (prisma/schema.prisma) in one place: rows a human has
// touched are never replaced. Re-running extraction on an update refreshes the
// machine-written rows and leaves every corrected value alone.

/// The amount a payment reminder is for, preferring what the model read and
/// falling back to the wire table in the same email.
///
/// The model will not attribute an unlabelled "Investment | Fees | Total" row
/// to the reader, and it is right to be careful: a wrong figure here closes a
/// debt that is still owed. The table parser has no such doubt, because it only
/// accepts a row that adds up. Fill, never overwrite: a figure the model did
/// state always wins.
function paymentAmount(
  item: { kind: string; amount: number | null },
  rawText: string | undefined,
): number | null {
  if (item.kind !== "PAYMENT_DUE") return null;
  if (item.amount != null) return item.amount;
  return rawText ? (parseWireTable(rawText)?.total ?? null) : null;
}

export async function applyExtraction(
  userId: string,
  updateId: string,
  companyId: string,
  extraction: Extraction,
  context?: { subject: string | null; rawText: string },
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
        direction: signal.direction,
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
        // Only a payment carries one, whatever the model returns: an amount on
        // an intro or a consent has nothing that could ever settle it.
        amount: paymentAmount(item, context?.rawText),
        dueDate: parseDate(item.dueDate),
        sourceQuote: item.sourceQuote,
      })),
    });

    await tx.update.update({
      where: { id: updateId },
      data: { summary: extraction.summary, extractedAt: new Date() },
    });
  });

  // A bank transfer is independent evidence that money moved, so it is
  // reconciled against what the portfolio says was invested.
  if (extraction.payment && context) {
    await recordPayment(userId, {
      updateId,
      companyId,
      subject: context.subject,
      rawText: context.rawText,
      payment: extraction.payment,
    });
  }

  // A completed DocuSign envelope proves execution, not payment. It fills an
  // empty investment date and marks the instrument as signed, nothing more.
  if (extraction.execution) {
    const signedDate = extraction.execution.signedDate
      ? new Date(`${extraction.execution.signedDate}T00:00:00.000Z`)
      : null;

    if (signedDate && !Number.isNaN(signedDate.getTime())) {
      await prisma.signal.create({
        data: {
          userId,
          companyId,
          updateId,
          kind: "MILESTONE",
          severity: "LOW",
          summary: `Signed: ${extraction.execution.documentTitle}`,
          sourceQuote: extraction.execution.sourceQuote,
          derived: false,
        },
      });
    }
  }
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
    linkedText?: string[];
  }) => Promise<Extraction>,
  opts: { limit?: number } = {},
): Promise<{ extracted: number; failed: number }> {
  const updates = await prisma.update.findMany({
    where: { userId, reviewState: "CONFIRMED", companyId: { not: null }, extractedAt: null },
    include: { company: { select: { name: true } } },
    orderBy: { receivedAt: "desc" },
    take: opts.limit ?? 25,
  });

  // Each update is an independent model call of several seconds, so they run in
  // parallel under a ceiling. Sequentially, sixty emails is ten minutes of
  // waiting; this is the difference between a button that works and one that
  // looks broken.
  const results = await mapWithConcurrency(updates, async (update) => {
    const result = await runner({
      companyName: update.company?.name,
      subject: update.subject,
      receivedAt: update.receivedAt,
      text: update.rawText,
      linkedText: await linkedTextForUpdate(update.id),
    });
    await applyExtraction(userId, update.id, update.companyId!, result, {
      subject: update.subject,
      rawText: update.rawText,
    });
  });

  // One unreadable email stays unextracted and is retried on the next run.
  const extracted = results.filter((entry) => entry.status === "fulfilled").length;
  const failed = results.length - extracted;

  return { extracted, failed };
}
