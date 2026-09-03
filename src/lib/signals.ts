// Deterministic risk rules. These need no LLM: they read dates and numbers the
// app already has and say what deserves attention. Kept pure and separate from
// the extraction layer so the highest-value signals still work on a portfolio
// with no email connected at all.

export type DerivedSignalKind =
  | "SILENCE"
  | "RUNWAY_LOW"
  | "MATURITY_APPROACHING"
  | "QSBS_APPROACHING"
  | "QSBS_REACHED"
  | "DOWN_ROUND";

export type Severity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export interface DerivedSignal {
  kind: DerivedSignalKind;
  severity: Severity;
  summary: string;
}

const DAY = 24 * 60 * 60 * 1000;

export function daysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / DAY);
}

export function addYears(date: Date, years: number): Date {
  const out = new Date(date.getTime());
  out.setUTCFullYear(out.getUTCFullYear() + years);
  return out;
}

/// Silence is the single most useful flag in an angel portfolio: a founder who
/// stops writing is usually a founder with bad news. Thresholds escalate rather
/// than firing once, so a company that goes quiet keeps getting louder.
export function silenceSignal(
  lastUpdateAt: Date | null,
  asOf: Date,
  opts: { firstInvestmentAt?: Date | null } = {},
): DerivedSignal | null {
  // With no update ever, measure from the investment date instead, so a company
  // that has never written is not silently treated as fine.
  const since = lastUpdateAt ?? opts.firstInvestmentAt ?? null;
  if (!since) return null;

  const days = daysBetween(since, asOf);
  const noun = lastUpdateAt ? "No investor update" : "No investor update ever received";

  if (days >= 365) {
    return { kind: "SILENCE", severity: "CRITICAL", summary: `${noun} in ${days} days.` };
  }
  if (days >= 180) {
    return { kind: "SILENCE", severity: "HIGH", summary: `${noun} in ${days} days.` };
  }
  if (days >= 90) {
    return { kind: "SILENCE", severity: "MEDIUM", summary: `${noun} in ${days} days.` };
  }
  return null;
}

export function runwaySignal(runwayMonths: number | null): DerivedSignal | null {
  if (runwayMonths == null) return null;
  if (runwayMonths <= 3) {
    return {
      kind: "RUNWAY_LOW",
      severity: "CRITICAL",
      summary: `Reported runway is ${runwayMonths} months.`,
    };
  }
  if (runwayMonths <= 6) {
    return {
      kind: "RUNWAY_LOW",
      severity: "HIGH",
      summary: `Reported runway is ${runwayMonths} months.`,
    };
  }
  return null;
}

/// A note past maturity is not a filing deadline, it is a conversation with the
/// founder that has to happen. Past due is louder than approaching.
export function maturitySignal(maturityDate: Date | null, asOf: Date): DerivedSignal | null {
  if (!maturityDate) return null;
  const days = daysBetween(asOf, maturityDate);
  if (days < 0) {
    return {
      kind: "MATURITY_APPROACHING",
      severity: "HIGH",
      summary: `Note matured ${Math.abs(days)} days ago with no recorded conversion or repayment.`,
    };
  }
  if (days <= 90) {
    return {
      kind: "MATURITY_APPROACHING",
      severity: "MEDIUM",
      summary: `Note matures in ${days} days.`,
    };
  }
  return null;
}

/// QSBS (IRC §1202) can exempt a large share of the gain after five years of
/// holding. Selling a week early is an expensive mistake, so this fires early
/// and then confirms.
export function qsbsSignal(
  investmentDate: Date | null,
  qsbsEligible: boolean,
  asOf: Date,
): DerivedSignal | null {
  if (!investmentDate || !qsbsEligible) return null;
  const matures = addYears(investmentDate, 5);
  const days = daysBetween(asOf, matures);

  if (days <= 0) {
    return {
      kind: "QSBS_REACHED",
      severity: "LOW",
      summary: `Five-year QSBS holding period reached on ${matures.toISOString().slice(0, 10)}.`,
    };
  }
  if (days <= 180) {
    return {
      kind: "QSBS_APPROACHING",
      severity: "MEDIUM",
      summary: `QSBS five-year date is ${days} days away (${matures.toISOString().slice(0, 10)}). Do not sell before it.`,
    };
  }
  return null;
}

export interface ValuationPoint {
  date: Date;
  postMoneyValuation: number | null;
}

/// A priced round below the previous one. Only priced rounds count: comparing
/// an estimate against a real round produces noise, not signal.
export function downRoundSignal(valuations: ValuationPoint[]): DerivedSignal | null {
  const priced = valuations
    .filter((v) => v.postMoneyValuation != null)
    .sort((a, b) => a.date.getTime() - b.date.getTime());
  if (priced.length < 2) return null;

  const latest = priced[priced.length - 1]!;
  const previous = priced[priced.length - 2]!;
  if (latest.postMoneyValuation! >= previous.postMoneyValuation!) return null;

  const dropPct = Math.round(
    (1 - latest.postMoneyValuation! / previous.postMoneyValuation!) * 100,
  );
  return {
    kind: "DOWN_ROUND",
    severity: dropPct >= 50 ? "HIGH" : "MEDIUM",
    summary: `Latest mark is ${dropPct}% below the previous one.`,
  };
}

export interface CompanySignalInputs {
  lastUpdateAt: Date | null;
  firstInvestmentAt: Date | null;
  runwayMonths: number | null;
  maturityDates: (Date | null)[];
  qsbsPositions: { investmentDate: Date; qsbsEligible: boolean }[];
  valuations: ValuationPoint[];
}

const SEVERITY_ORDER: Severity[] = ["CRITICAL", "HIGH", "MEDIUM", "LOW"];

/// All derived signals for one company, most severe first.
export function deriveCompanySignals(input: CompanySignalInputs, asOf: Date): DerivedSignal[] {
  const signals: (DerivedSignal | null)[] = [
    silenceSignal(input.lastUpdateAt, asOf, { firstInvestmentAt: input.firstInvestmentAt }),
    runwaySignal(input.runwayMonths),
    ...input.maturityDates.map((date) => maturitySignal(date, asOf)),
    ...input.qsbsPositions.map((p) => qsbsSignal(p.investmentDate, p.qsbsEligible, asOf)),
    downRoundSignal(input.valuations),
  ];

  return signals
    .filter((s): s is DerivedSignal => s !== null)
    .sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity));
}
