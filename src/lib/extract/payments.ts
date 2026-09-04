import "server-only";
import { prisma } from "@/lib/prisma";
import { matchCompanyByContent } from "@/lib/gmail/content-match";
import { reconcilePayment, type RecordedPosition } from "@/lib/reconcile";
import { recordClaim } from "@/lib/claims";
import type { Extraction } from "./schema";

// Turning an extracted bank transfer into a reconciled Payment.
//
// The payment record is kept whatever the verdict. A transfer that disagrees
// with what is recorded is a fact worth keeping and showing, not an error to
// overwrite: it usually means an amount was entered from a commitment that
// later changed.

function parseDate(value: string | null): Date | null {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function toNumber(value: unknown): number {
  if (value == null) return 0;
  return typeof value === "number" ? value : Number(value.toString());
}

export interface PaymentResult {
  recorded: boolean;
  state: "UNMATCHED" | "CONFIRMED" | "DISCREPANCY";
}

export async function recordPayment(
  userId: string,
  input: {
    updateId: string;
    companyId: string | null;
    subject: string | null;
    rawText: string;
    payment: NonNullable<Extraction["payment"]>;
  },
): Promise<PaymentResult | null> {
  const valueDate = parseDate(input.payment.valueDate);
  if (!valueDate || !Number.isFinite(input.payment.amount)) return null;

  // A bank sends from its own domain, so the company is found by what the email
  // says: the beneficiary line, the reference, or a name in the subject.
  let companyId = input.companyId;
  if (!companyId) {
    const companies = await prisma.company.findMany({
      where: { userId },
      select: { id: true, name: true },
    });
    const match = matchCompanyByContent(
      [input.payment.beneficiary, input.payment.reference, input.payment.companyName, input.rawText]
        .filter(Boolean)
        .join("\n"),
      companies.map((company) => ({ companyId: company.id, name: company.name })),
      { subject: input.subject },
    );
    if (match && match.confidence >= 0.8) companyId = match.companyId;
  }

  let positions: RecordedPosition[] = [];
  if (companyId) {
    const rows = await prisma.position.findMany({
      where: { userId, companyId },
      include: { transactions: true },
    });
    positions = rows.map((row) => ({
      id: row.id,
      invested: row.transactions
        .filter((transaction) => transaction.kind === "INVESTMENT" || transaction.kind === "CAPITAL_CALL")
        .reduce((total, transaction) => total + toNumber(transaction.amount), 0),
      fees: row.transactions
        .filter((transaction) => transaction.kind === "FEE")
        .reduce((total, transaction) => total + toNumber(transaction.amount), 0),
      investmentDate: row.investmentDate,
    }));
  }

  const verdict = reconcilePayment(
    { amount: input.payment.amount, valueDate },
    positions,
    { knownFees: input.payment.statedFees },
  );

  const state =
    verdict.kind === "CONFIRMED" || verdict.kind === "CONFIRMED_WITH_FEES"
      ? "CONFIRMED"
      : verdict.kind === "DISCREPANCY"
        ? "DISCREPANCY"
        : "UNMATCHED";

  const created = await prisma.payment.create({
    data: {
      userId,
      updateId: input.updateId,
      companyId,
      positionId: "positionId" in verdict ? verdict.positionId : null,
      amount: input.payment.amount,
      currency: input.payment.currency || "USD",
      valueDate,
      beneficiary: input.payment.beneficiary,
      reference: input.payment.reference,
      state,
      note: verdict.note,
      sourceQuote: input.payment.sourceQuote,
    },
  });

  // What the bank says left the account, which is a gross figure: investment
  // plus whatever fees were bundled in.
  if (companyId) {
    await recordClaim({
      userId,
      companyId,
      positionId: "positionId" in verdict ? verdict.positionId : null,
      source: "BANK_TRANSFER",
      kind: "TOTAL",
      amount: input.payment.amount,
      sourceQuote: input.payment.sourceQuote,
      updateId: input.updateId,
      paymentId: created.id,
    });
    if (input.payment.statedFees != null) {
      await recordClaim({
        userId,
        companyId,
        positionId: "positionId" in verdict ? verdict.positionId : null,
        source: "BANK_TRANSFER",
        kind: "FEE",
        amount: input.payment.statedFees,
        sourceQuote: input.payment.sourceQuote,
        updateId: input.updateId,
        paymentId: created.id,
      });
    }
  }

  // Fees the wire revealed are recorded as their own ledger line, so the return
  // is honest and the next reconciliation matches without re-deriving them.
  if (verdict.kind === "CONFIRMED_WITH_FEES") {
    await prisma.transaction.create({
      data: {
        userId,
        positionId: verdict.positionId,
        kind: "FEE",
        amount: verdict.impliedFees,
        date: valueDate,
        notes: `From a bank transfer of ${input.payment.amount}: the excess over the recorded investment.`,
      },
    });
  }

  // A confirmed transfer answers the "confirm the wire was sent" task the
  // importer raises for a commitment.
  if (state === "CONFIRMED" && companyId) {
    await prisma.actionItem.updateMany({
      where: { userId, companyId, kind: "FOLLOW_UP", state: "OPEN", title: { contains: "wire" } },
      data: { state: "DONE", completedAt: new Date() },
    });
  }

  return { recorded: true, state };
}
