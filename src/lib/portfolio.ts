// Deterministic portfolio math. Every number the UI shows comes from here, and
// every function is pure so it can be unit tested without a database. Nothing
// in this file talks to Prisma; callers map rows onto these plain shapes.

export type CashKind =
  | "INVESTMENT"
  | "CAPITAL_CALL"
  | "FEE"
  | "DISTRIBUTION"
  | "SECONDARY_SALE"
  | "WRITE_OFF";

export interface Cashflow {
  kind: CashKind;
  amount: number;
  date: Date;
}

/// Cash leaving the investor. Fees are included: a management fee is money out
/// that bought no ownership, and hiding it flatters the return.
const OUTFLOW_KINDS: CashKind[] = ["INVESTMENT", "CAPITAL_CALL", "FEE"];
const INFLOW_KINDS: CashKind[] = ["DISTRIBUTION", "SECONDARY_SALE"];

function sumOf(flows: Cashflow[], kinds: CashKind[]): number {
  return round2(
    flows.filter((f) => kinds.includes(f.kind)).reduce((total, f) => total + f.amount, 0),
  );
}

/// Total cash out, fees included.
export function totalDeployed(flows: Cashflow[]): number {
  return sumOf(flows, OUTFLOW_KINDS);
}

/// Cash out that actually bought ownership. This is the cost basis that matters
/// for tax and for per-share math, so it deliberately excludes fees.
export function costBasis(flows: Cashflow[]): number {
  return sumOf(flows, ["INVESTMENT", "CAPITAL_CALL"]);
}

/// Cash returned: distributions plus secondary sales.
export function totalRealized(flows: Cashflow[]): number {
  return sumOf(flows, INFLOW_KINDS);
}

export function isWrittenOff(flows: Cashflow[]): boolean {
  return flows.some((f) => f.kind === "WRITE_OFF");
}

export interface MarkInputs {
  /// Shares held, when the position is priced equity.
  shareCount?: number | null;
  /// Latest known price per share for the company.
  latestPricePerShare?: number | null;
  /// True once the company is dead: the mark is zero regardless of anything else.
  companyIsDead?: boolean;
}

/// Current value of what is still held.
///
/// Convention, and the reason this is not just shares × price:
///   - A dead company marks to zero, whatever the last round said.
///   - A written-off position marks to zero.
///   - Priced equity with a known share count and price marks to shares × price.
///   - Anything else (an unconverted SAFE, a note, a position with no mark) is
///     carried at cost. Angel convention, and it is honest: an uncapped guess
///     is worse than the number actually paid.
export function unrealizedValue(flows: Cashflow[], mark: MarkInputs): number {
  if (mark.companyIsDead || isWrittenOff(flows)) return 0;

  const { shareCount, latestPricePerShare } = mark;
  if (shareCount != null && latestPricePerShare != null) {
    return round2(shareCount * latestPricePerShare);
  }

  // Carried at cost, and cost means what was actually paid: the investment plus
  // the fees that came with it. Carrying at the fee-free basis while deploying
  // the gross made every position read 0.91x with a deeply negative IRR from
  // the day it was created, which describes the accounting rather than the
  // company.
  return round2(Math.max(totalDeployed(flows) - totalRealized(flows), 0));
}

/// Multiple on invested capital: everything back plus everything still held,
/// over everything put in. Returns null when nothing has been deployed, rather
/// than dividing by zero.
export function moic(flows: Cashflow[], mark: MarkInputs): number | null {
  const deployed = totalDeployed(flows);
  if (deployed <= 0) return null;
  const value = totalRealized(flows) + unrealizedValue(flows, mark);
  return round4(value / deployed);
}

/// Annualized IRR over dated cashflows (an XIRR), solved by bisection.
///
/// Bisection rather than Newton: it cannot diverge, and portfolio cashflows are
/// often pathological (one outflow, one inflow years later). Returns null when
/// there is no sign change, which is the honest answer for a position that has
/// only ever taken money in.
///
/// `asOf` and `residualValue` inject the current mark as a synthetic final
/// inflow, which is what makes an IRR meaningful for an unexited position.
export function irr(
  flows: Cashflow[],
  opts: { asOf: Date; residualValue: number },
): number | null {
  const dated: { amount: number; date: Date }[] = flows
    .filter((f) => OUTFLOW_KINDS.includes(f.kind) || INFLOW_KINDS.includes(f.kind))
    .map((f) => ({
      amount: OUTFLOW_KINDS.includes(f.kind) ? -f.amount : f.amount,
      date: f.date,
    }));

  if (opts.residualValue > 0) {
    dated.push({ amount: opts.residualValue, date: opts.asOf });
  }
  if (dated.length < 2) return null;

  const hasPositive = dated.some((f) => f.amount > 0);
  const hasNegative = dated.some((f) => f.amount < 0);
  if (!hasPositive || !hasNegative) return null;

  const start = dated.reduce((min, f) => (f.date < min ? f.date : min), dated[0]!.date);
  const years = (d: Date) => (d.getTime() - start.getTime()) / (365.25 * 24 * 60 * 60 * 1000);

  const npv = (rate: number) =>
    dated.reduce((total, f) => total + f.amount / Math.pow(1 + rate, years(f.date)), 0);

  // -99.99% to +10,000%. Anything outside that is noise, not a return.
  let low = -0.9999;
  let high = 100;
  if (npv(low) * npv(high) > 0) return null;

  for (let i = 0; i < 200; i++) {
    const mid = (low + high) / 2;
    if (npv(low) * npv(mid) <= 0) high = mid;
    else low = mid;
  }
  return round4((low + high) / 2);
}

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function round4(n: number): number {
  return Math.round((n + Number.EPSILON) * 10000) / 10000;
}
