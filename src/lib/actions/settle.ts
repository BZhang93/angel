import "server-only";
import { prisma } from "@/lib/prisma";
import {
  resolveAcrossPayments,
  resolveOnFundingComplete,
  type ConfirmedPayment,
  type OpenAction,
  type Resolution,
} from "./auto-resolve";

// Settling a company's open obligations against everything known about it.
//
// This used to run in one direction only, from a payment as it was recorded,
// against whatever happened to be open at that instant. Anything created later
// was invisible to it forever, and "later" is the normal case: Zaqa's payment
// was recorded nineteen hours before the reminder it settles, because the
// reminder came from an email that was still unfiled at the time. An exact
// match on amount and thread was missed permanently.
//
// So resolution is bidirectional now. Both a new payment and a newly extracted
// reminder run the same sweep for that company, and a one-off backfill runs it
// for all of them.

function toNumber(value: unknown): number | null {
  if (value == null) return null;
  return typeof value === "number" ? value : Number(value.toString());
}

async function openActionsFor(userId: string, companyId: string): Promise<OpenAction[]> {
  const rows = await prisma.actionItem.findMany({
    where: { userId, companyId, state: "OPEN" },
    select: {
      id: true,
      kind: true,
      amount: true,
      dueDate: true,
      createdAt: true,
      update: { select: { gmailThreadId: true, receivedAt: true } },
    },
  });

  return rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    amount: toNumber(row.amount),
    dueDate: row.dueDate,
    createdAt: row.createdAt,
    threadId: row.update?.gmailThreadId ?? null,
    sourceAt: row.update?.receivedAt ?? null,
  }));
}

async function applyResolutions(resolutions: Resolution[]): Promise<number> {
  if (resolutions.length === 0) return 0;

  const details = new Map(
    (
      await prisma.actionItem.findMany({
        where: { id: { in: resolutions.map((entry) => entry.id) } },
        select: { id: true, detail: true },
      })
    ).map((row) => [row.id, row.detail]),
  );

  for (const resolution of resolutions) {
    const existing = details.get(resolution.id);
    await prisma.actionItem.update({
      where: { id: resolution.id },
      data: {
        state: "DONE",
        completedAt: new Date(),
        detail: existing ? `${existing}\n\n${resolution.note}` : resolution.note,
      },
    });
  }

  return resolutions.length;
}

/// The threads a payment settles: the bank's own, and the syndicate's
/// wire-instructions thread, which is where the reminders actually live.
async function threadsFor(
  userId: string,
  payment: { updateId: string | null; positionId: string | null },
): Promise<string[]> {
  const [source, claim] = await Promise.all([
    payment.updateId
      ? prisma.update.findUnique({
          where: { id: payment.updateId },
          select: { gmailThreadId: true },
        })
      : null,
    payment.positionId
      ? prisma.amountClaim.findFirst({
          where: { userId, positionId: payment.positionId, source: "WIRE_INSTRUCTION" },
          select: { updateId: true },
        })
      : null,
  ]);

  const wire = claim?.updateId
    ? await prisma.update.findUnique({
        where: { id: claim.updateId },
        select: { gmailThreadId: true },
      })
    : null;

  return [source?.gmailThreadId, wire?.gmailThreadId].filter(
    (thread): thread is string => !!thread,
  );
}

/// Runs every confirmed payment for a company against everything still open.
///
/// Payments are applied oldest first and an item settled by one is withdrawn
/// before the next is considered, which keeps the "one transfer discharges one
/// obligation" rule true across a sweep as well as within a single payment.
export async function settleCompanyActions(userId: string, companyId: string): Promise<number> {
  const open = await openActionsFor(userId, companyId);
  if (open.length === 0) return 0;

  const rows = await prisma.payment.findMany({
    where: { userId, companyId, state: "CONFIRMED" },
    select: { amount: true, valueDate: true, updateId: true, positionId: true },
  });

  const payments: ConfirmedPayment[] = await Promise.all(
    rows.map(async (row) => ({
      amount: toNumber(row.amount) ?? 0,
      valueDate: row.valueDate,
      threadIds: await threadsFor(userId, row),
    })),
  );

  return applyResolutions(resolveAcrossPayments(open, payments));
}

/// Closes what a stated funding completion settles, with no Payment involved.
export async function settleOnFundingComplete(
  userId: string,
  companyId: string,
  event: { at: Date; threadId: string | null },
): Promise<number> {
  const open = await openActionsFor(userId, companyId);
  if (open.length === 0) return 0;

  return applyResolutions(resolveOnFundingComplete(open, event));
}
