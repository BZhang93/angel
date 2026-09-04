import "server-only";
import { prisma } from "@/lib/prisma";
import { downloadAttachment } from "@/lib/storage";
import { extractDocumentTerms, type DocumentTerms } from "./document";
import { attachOrphanClaims, recordClaim } from "@/lib/claims";
import { mapWithConcurrency } from "@/lib/concurrency";
import { chooseTargetPosition, gapsOnly, parseIsoDate } from "./fill";

// Folding a document's terms into the portfolio.
//
// The rule that governs everything here lives in ./fill.ts, where it is unit
// tested: a document may fill a gap, never overwrite.

/// Writes what a signed document says into the portfolio.
///
/// Reading terms is only half the job. A subscription agreement states the
/// purchase price and the fee, so a document can be the only place an
/// investment is recorded at all: without this, a company shows no position
/// while its own signed agreement sits underneath saying $3,000.
///
/// Rules, in order:
///   - an unsigned draft changes nothing
///   - terms fill gaps on an existing position, never overwrite
///   - an amount with a date creates the position when none exists
///   - fees are their own ledger line, never folded into the amount
export async function applyTermsToPortfolio(
  userId: string,
  companyId: string,
  documentId: string,
  terms: DocumentTerms,
  opts: { docusignEnvelopeId?: string | null } = {},
): Promise<{ positionId: string | null; filled: boolean; recordedAmount: boolean }> {
  const docusignEnvelopeId = opts.docusignEnvelopeId ?? null;
  if (!terms.isExecuted) return { positionId: null, filled: false, recordedAmount: false };

  const positions = await prisma.position.findMany({
    where: { companyId, userId },
    include: { transactions: true },
  });

  let target = chooseTargetPosition(positions, terms);
  const investmentDate = parseIsoDate(terms.investmentDate);
  let filled = false;
  let recordedAmount = false;

  // Nothing recorded yet: the document itself is the evidence, so create the
  // position it describes. A date is required, since it drives the QSBS and IRR
  // clocks and a guessed one would be worse than none.
  if (!target && investmentDate) {
    const created = await prisma.position.create({
      data: {
        userId,
        companyId,
        instrumentType: terms.instrumentType,
        underlyingInstrument: terms.underlyingInstrument,
        investmentGroup: terms.investmentGroup,
        investmentDate,
        valuationCap: terms.valuationCap,
        discountPct: terms.discountPct,
        safeIsPostMoney: terms.safeIsPostMoney,
        interestRatePct: terms.interestRatePct,
        maturityDate: parseIsoDate(terms.maturityDate),
        shareClass: terms.shareClass,
        shareCount: terms.shareCount,
        pricePerShare: terms.pricePerShare,
        notes: "Created from a signed document.",
      },
      include: { transactions: true },
    });
    target = created;
    filled = true;
  }

  if (!target) return { positionId: null, filled: false, recordedAmount: false };

  // Compared field by field against a narrow view of the position, so the patch
  // is exactly the fillable columns and nothing from the relations.
  const current = {
    underlyingInstrument: target.underlyingInstrument,
    investmentGroup: target.investmentGroup,
    valuationCap: target.valuationCap,
    discountPct: target.discountPct,
    safeIsPostMoney: target.safeIsPostMoney,
    interestRatePct: target.interestRatePct,
    maturityDate: target.maturityDate,
    shareClass: target.shareClass,
    shareCount: target.shareCount,
    pricePerShare: target.pricePerShare,
  };

  const patch = gapsOnly(current, {
    underlyingInstrument: terms.underlyingInstrument,
    investmentGroup: terms.investmentGroup,
    valuationCap: terms.valuationCap,
    discountPct: terms.discountPct,
    safeIsPostMoney: terms.safeIsPostMoney,
    interestRatePct: terms.interestRatePct,
    maturityDate: parseIsoDate(terms.maturityDate),
    shareClass: terms.shareClass,
    shareCount: terms.shareCount,
    pricePerShare: terms.pricePerShare,
  });
  if (Object.keys(patch).length > 0) {
    await prisma.position.update({ where: { id: target.id }, data: patch });
    filled = true;
  }

  const existing = await prisma.transaction.findMany({ where: { positionId: target.id } });
  const hasInvestment = existing.some(
    (transaction) => transaction.kind === "INVESTMENT" || transaction.kind === "CAPITAL_CALL",
  );
  const hasFee = existing.some((transaction) => transaction.kind === "FEE");
  const date = investmentDate ?? target.investmentDate;

  // The amount is only added when the ledger is empty: a document must not
  // duplicate a cheque already recorded from an email or a bank transfer.
  if (!hasInvestment && terms.amount != null && terms.amount > 0) {
    await prisma.transaction.create({
      data: {
        userId,
        positionId: target.id,
        kind: "INVESTMENT",
        amount: terms.amount,
        date,
        notes: "From the signed document.",
      },
    });
    recordedAmount = true;
  }

  if (!hasFee && terms.feesAmount != null && terms.feesAmount > 0) {
    await prisma.transaction.create({
      data: {
        userId,
        positionId: target.id,
        kind: "FEE",
        amount: terms.feesAmount,
        date,
        notes: "Fee stated in the signed document.",
      },
    });
  }

  await prisma.document.update({
    where: { id: documentId },
    data: { positionId: target.id },
  });

  // What the document says, kept beside what every other source says, so a
  // disagreement can be named rather than merely detected.
  const source: "DOCUSIGN" | "DOCUMENT" = docusignEnvelopeId ? "DOCUSIGN" : "DOCUMENT";
  if (terms.amount != null) {
    await recordClaim({
      userId,
      companyId,
      positionId: target.id,
      source,
      kind: "INVESTMENT",
      amount: terms.amount,
      sourceQuote: terms.sourceQuotes?.amount ?? null,
      documentId,
    });
  }
  if (terms.feesAmount != null) {
    await recordClaim({
      userId,
      companyId,
      positionId: target.id,
      source,
      kind: "FEE",
      amount: terms.feesAmount,
      sourceQuote: terms.sourceQuotes?.feesAmount ?? null,
      documentId,
    });
  }
  await attachOrphanClaims(userId, companyId, target.id);

  return { positionId: target.id, filled, recordedAmount };
}

export interface DocumentExtractionResult {
  extracted: number;
  filled: number;
  failed: number;
}

/// Reads every stored, unextracted document and applies what it finds.
export async function extractPendingDocuments(
  userId: string,
  opts: { limit?: number } = {},
): Promise<DocumentExtractionResult> {
  const documents = await prisma.document.findMany({
    where: { userId, extractedAt: null, storagePath: { not: null } },
    include: { company: { select: { id: true, name: true } } },
    orderBy: { createdAt: "desc" },
    take: opts.limit ?? 20,
  });

  let filled = 0;

  // Reading a PDF is another wait on the model; several run at once.
  const results = await mapWithConcurrency(documents, async (document) => {
    const bytes = await downloadAttachment(document.storagePath!);
    const terms: DocumentTerms = await extractDocumentTerms(bytes, {
      filename: document.title,
      companyName: document.company?.name,
      formFields: Array.isArray(document.formFields)
        ? (document.formFields as { name: string; value: string }[])
        : undefined,
    });

    await prisma.document.update({
      where: { id: document.id },
      data: {
        kind: terms.documentKind,
        summary: terms.summary,
        extractedAt: new Date(),
      },
    });

    if (!document.companyId) return;

    const applied = await applyTermsToPortfolio(userId, document.companyId, document.id, terms, {
      docusignEnvelopeId: document.docusignEnvelopeId,
    });
    if (applied.filled || applied.recordedAmount) filled += 1;
  });

  const extracted = results.filter((entry) => entry.status === "fulfilled").length;
  const failed = results.length - extracted;

  return { extracted, filled, failed };
}
