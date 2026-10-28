import type { CashKind } from "./portfolio";

// How a position ends.
//
// A position and the company it is in have separate fates, and conflating them
// is what made the Marr Labs refund unrecordable: the SPV returned the money
// while the company carried on, so CompanyStatus had nothing true to say. These
// states describe the investor's holding. CompanyStatus still describes the
// company.
//
// Conversion is deliberately absent. A SAFE that converts has not ended, it has
// become a priced position, and Position.convertedIntoId already records which
// one. Giving it a status too would create a second place to be wrong.

export type PositionStatus =
  | "ACTIVE"
  | "EXITED"
  | "SECONDARY_SOLD"
  | "REPAID"
  | "WRITTEN_OFF"
  | "REFUNDED"
  | "CANCELLED";

export interface OutcomeSpec {
  status: PositionStatus;
  label: string;
  /// What this outcome means, shown next to the control that sets it. The
  /// difference between a refund and a write-off is money, so the wording has
  /// to be unambiguous at the moment of choosing.
  blurb: string;
  /// The ledger line this outcome writes, if any. Cash is never implied by a
  /// status: totals, MOIC and IRR are summed from transactions, so an outcome
  /// that moved money has to say how much.
  ledgerKind: CashKind | null;
  /// Whether the amount is the point. A write-off is dated and zero by
  /// convention; a cancelled commitment never moved at all.
  expectsProceeds: boolean;
}

/// The closed outcomes, in the order they are offered: the good ones first,
/// then the ones where the money came back, then the loss.
export const OUTCOMES: OutcomeSpec[] = [
  {
    status: "EXITED",
    label: "Exited",
    blurb: "Acquired, IPO'd or otherwise cashed out. Record what you received.",
    ledgerKind: "DISTRIBUTION",
    expectsProceeds: true,
  },
  {
    status: "SECONDARY_SOLD",
    label: "Sold (secondary)",
    blurb: "The stake was sold to another buyer while the company carried on.",
    ledgerKind: "SECONDARY_SALE",
    expectsProceeds: true,
  },
  {
    status: "REPAID",
    label: "Note repaid",
    blurb: "A convertible note matured and was repaid in cash instead of converting.",
    ledgerKind: "DISTRIBUTION",
    expectsProceeds: true,
  },
  {
    status: "REFUNDED",
    label: "Refunded",
    blurb: "The deal never happened and the money came back. No interest was acquired.",
    ledgerKind: "DISTRIBUTION",
    expectsProceeds: true,
  },
  {
    status: "WRITTEN_OFF",
    label: "Written off",
    blurb: "The company failed or the stake is worthless. Dated for the tax year, at zero.",
    ledgerKind: "WRITE_OFF",
    expectsProceeds: false,
  },
  {
    status: "CANCELLED",
    label: "Cancelled",
    blurb: "Committed but never funded: the allocation lapsed or was withdrawn.",
    ledgerKind: null,
    expectsProceeds: false,
  },
];

const BY_STATUS = new Map(OUTCOMES.map((outcome) => [outcome.status, outcome]));

export function outcomeFor(status: string): OutcomeSpec | null {
  return BY_STATUS.get(status as PositionStatus) ?? null;
}

/// Closed means the investor holds nothing further from this position, whatever
/// it returned. Everything it was worth is in the ledger by then, so the mark
/// is zero.
export function isClosed(status: string): boolean {
  return status !== "ACTIVE" && BY_STATUS.has(status as PositionStatus);
}

export function statusLabel(status: string): string {
  return outcomeFor(status)?.label ?? "Active";
}

/// The one word for a company whose positions have all ended, or null while any
/// of them is live or they disagree. A first cheque written off beside a live
/// follow-on is not a closed company, and a secondary sale beside an exit is
/// two different stories that should not be flattened into one badge.
export function sharedOutcome(statuses: string[]): string | null {
  if (statuses.length === 0) return null;
  if (!statuses.every(isClosed)) return null;
  const distinct = new Set(statuses);
  return distinct.size === 1 ? statusLabel(statuses[0]!) : "Closed";
}
