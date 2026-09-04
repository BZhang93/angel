// Reconciling a bank transfer against what the portfolio says was invested.
//
// The wrinkle that makes this worth doing carefully: a wire usually bundles the
// investment and the fees into one number. $3,000 committed with $283.50 of
// legal fees leaves the account as $3,283.50. So a transfer that "does not
// match" the recorded $3,000 may confirm it exactly, once fees are accounted
// for. Getting that backwards would either flag every correct record as a
// discrepancy, or silently record fees as invested capital.
//
// Pure and tested: this decides whether money is treated as confirmed.

export interface RecordedPosition {
  id: string;
  /// Cash recorded as invested, excluding fees.
  invested: number;
  /// Fees already recorded against the position.
  fees: number;
  investmentDate: Date;
}

export type Verdict =
  | { kind: "CONFIRMED"; positionId: string; note: string }
  | { kind: "CONFIRMED_WITH_FEES"; positionId: string; impliedFees: number; note: string }
  | { kind: "DISCREPANCY"; positionId: string; difference: number; note: string }
  | { kind: "NO_POSITION"; suggestedInvestment: number | null; note: string };

/// Cent-level tolerance. Banks and cap table software round differently, and a
/// penny is not a discrepancy worth a person's attention.
const TOLERANCE = 0.02;

function money(value: number): string {
  return `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/// Positions are candidates when they belong to the matched company; the
/// closest by date wins, since a company can be funded more than once.
export function closestByDate(
  positions: RecordedPosition[],
  valueDate: Date,
): RecordedPosition | null {
  if (positions.length === 0) return null;
  return positions.reduce((best, position) => {
    const bestGap = Math.abs(best.investmentDate.getTime() - valueDate.getTime());
    const gap = Math.abs(position.investmentDate.getTime() - valueDate.getTime());
    return gap < bestGap ? position : best;
  });
}

export function reconcilePayment(
  payment: { amount: number; valueDate: Date },
  positions: RecordedPosition[],
  opts: { knownFees?: number | null } = {},
): Verdict {
  const position = closestByDate(positions, payment.valueDate);

  if (!position) {
    // Nothing recorded to check against. The transfer still tells us what was
    // paid; fees stated elsewhere in the same email come out of it.
    const fees = opts.knownFees ?? 0;
    const suggested = payment.amount - fees;
    return {
      kind: "NO_POSITION",
      suggestedInvestment: suggested > 0 ? round2(suggested) : null,
      note:
        fees > 0
          ? `No position recorded. The transfer of ${money(payment.amount)} less ${money(fees)} of fees implies ${money(suggested)} invested.`
          : `No position recorded. The transfer of ${money(payment.amount)} is the whole amount that left the account, and may include fees.`,
    };
  }

  const expectedWithFees = position.invested + position.fees;

  // Gross match: the wire equals investment plus the fees already recorded.
  if (Math.abs(payment.amount - expectedWithFees) <= TOLERANCE) {
    return {
      kind: "CONFIRMED",
      positionId: position.id,
      note:
        position.fees > 0
          ? `Transfer of ${money(payment.amount)} matches ${money(position.invested)} invested plus ${money(position.fees)} of recorded fees.`
          : `Transfer of ${money(payment.amount)} matches the recorded investment exactly.`,
    };
  }

  // The wire is larger than everything recorded, and no fees are on file: the
  // difference is almost always the legal or admin fee bundled into the wire.
  const impliedFees = round2(payment.amount - expectedWithFees);
  if (impliedFees > 0 && impliedFees <= position.invested * 0.25) {
    return {
      kind: "CONFIRMED_WITH_FEES",
      positionId: position.id,
      impliedFees,
      note: `Transfer of ${money(payment.amount)} covers the recorded ${money(position.invested)} plus ${money(impliedFees)}, which is recorded as fees.`,
    };
  }

  return {
    kind: "DISCREPANCY",
    positionId: position.id,
    difference: round2(payment.amount - expectedWithFees),
    note:
      impliedFees > 0
        ? `Transfer of ${money(payment.amount)} is ${money(impliedFees)} more than the ${money(expectedWithFees)} recorded, which is too large to be fees.`
        : `Transfer of ${money(payment.amount)} is ${money(Math.abs(impliedFees))} less than the ${money(expectedWithFees)} recorded.`,
  };
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
