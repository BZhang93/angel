import type { Proposal, ProposedPosition } from "./schema";

// Combining what several senders say about one investment.
//
// The same deal is described four times: the syndicate announces it, the
// investor replies with a commitment, the bank confirms a wire, and DocuSign
// records the signature. Left alone that becomes four proposals and, worse,
// several positions for one cheque. This decides what is the same investment
// and which number to believe.

/// Whoever stated an amount, most credible first for the investor's own
/// position. Their commitment beats a syndicate's announcement of the round;
/// only a signed document or the bank's record of money moving is stronger
/// evidence that it happened, and neither is better evidence of the amount.
const STATED_BY_RANK: Record<string, number> = {
  INVESTOR: 0,
  DOCUMENT: 1,
  BANK: 2,
  SYNDICATE: 3,
  COMPANY: 4,
  UNKNOWN: 5,
};

function rank(statedBy: string | undefined): number {
  return STATED_BY_RANK[statedBy ?? "UNKNOWN"] ?? 5;
}

function daysApart(a: string | null, b: string | null): number | null {
  if (!a || !b) return null;
  const first = Date.parse(a);
  const second = Date.parse(b);
  if (Number.isNaN(first) || Number.isNaN(second)) return null;
  return Math.abs(first - second) / (24 * 60 * 60 * 1000);
}

/// One deal runs from announcement to signature to wire over some weeks, so
/// dates within this window describe the same investment rather than two.
const SAME_DEAL_DAYS = 75;

/// A wire bundles the investment and its fees, so a bank figure sits above the
/// committed amount by a fee-sized margin. Anything larger is a different deal.
const MAX_FEE_RATIO = 0.25;

export function isSameInvestment(a: ProposedPosition, b: ProposedPosition): boolean {
  const gap = daysApart(a.investmentDate, b.investmentDate);
  if (gap !== null && gap > SAME_DEAL_DAYS) return false;

  // Neither states an amount: only the dates can speak, and they agree.
  if (a.amount == null || b.amount == null) return true;

  const [smaller, larger] = a.amount <= b.amount ? [a, b] : [b, a];
  const difference = larger.amount! - smaller.amount!;
  if (difference <= 0.02) return true;

  // A bank's gross against a committed amount: the difference is the fee.
  const bankIsLarger = rank(larger.statedBy) === STATED_BY_RANK.BANK;
  return bankIsLarger && difference <= smaller.amount! * MAX_FEE_RATIO;
}

/// Combines two descriptions of one investment: the better-sourced amount wins,
/// the gross-minus-committed difference becomes the fee, and any term either
/// side knows is kept.
export function mergeInvestment(a: ProposedPosition, b: ProposedPosition): ProposedPosition {
  const [primary, other] = rank(a.statedBy) <= rank(b.statedBy) ? [a, b] : [b, a];

  let feesAmount = primary.feesAmount ?? other.feesAmount ?? null;
  if (
    feesAmount == null &&
    primary.amount != null &&
    other.amount != null &&
    rank(other.statedBy) === STATED_BY_RANK.BANK &&
    other.amount > primary.amount
  ) {
    // The wire covered the commitment plus something: that something is a fee.
    feesAmount = Math.round((other.amount - primary.amount) * 100) / 100;
  }

  return {
    ...primary,
    amount: primary.amount ?? other.amount,
    feesAmount,
    // A wire proves the money moved; an announcement does not.
    amountConfirmed: primary.amountConfirmed || other.amountConfirmed,
    investmentDate: primary.investmentDate ?? other.investmentDate,
    instrumentType:
      primary.instrumentType === "OTHER" ? other.instrumentType : primary.instrumentType,
    valuationCap: primary.valuationCap ?? other.valuationCap,
    discountPct: primary.discountPct ?? other.discountPct,
    safeIsPostMoney: primary.safeIsPostMoney ?? other.safeIsPostMoney,
    interestRatePct: primary.interestRatePct ?? other.interestRatePct,
    maturityDate: primary.maturityDate ?? other.maturityDate,
    hasProRata: primary.hasProRata ?? other.hasProRata,
    confidence: Math.max(primary.confidence, other.confidence),
  };
}

/// Collapses a list of proposed positions to one per actual investment.
export function dedupePositions(positions: ProposedPosition[]): ProposedPosition[] {
  const merged: ProposedPosition[] = [];

  for (const position of positions) {
    const index = merged.findIndex((candidate) => isSameInvestment(candidate, position));
    if (index >= 0) merged[index] = mergeInvestment(merged[index]!, position);
    else merged.push(position);
  }

  return merged;
}

/// Combines two readings of the same company, from the same sender or from
/// different ones. Scalar fields take whichever reading found a value;
/// positions are deduplicated rather than concatenated, which is what stops one
/// cheque becoming three.
export function mergeProposals(existing: Proposal | undefined, incoming: Proposal): Proposal {
  if (!existing) return { ...incoming, positions: dedupePositions(incoming.positions) };

  return {
    ...existing,
    name: existing.name.length >= incoming.name.length ? existing.name : incoming.name,
    investmentGroup: existing.investmentGroup ?? incoming.investmentGroup,
    website: existing.website ?? incoming.website,
    sector: existing.sector ?? incoming.sector,
    description: existing.description ?? incoming.description,
    contactName: existing.contactName ?? incoming.contactName,
    contactEmail: existing.contactEmail ?? incoming.contactEmail,
    stage: existing.stage === "UNKNOWN" ? incoming.stage : existing.stage,
    notes: [existing.notes, incoming.notes].filter(Boolean).join(" ") || null,
    confidence: Math.max(existing.confidence, incoming.confidence),
    positions: dedupePositions([...existing.positions, ...incoming.positions]),
  };
}
