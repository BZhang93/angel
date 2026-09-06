// Which way a company is going, on one five-point scale.
//
// Two things are known about a company and neither answers this alone. The
// metrics say what changed but arrive noisily and only for companies that send
// a real update: Bravi's month-on-month growth swings between 4% and 33%, so
// the latest delta is nearly meaningless on its own. The signals say what
// happened but carried no polarity until now, and a count of them says more
// about how talkative a founder is than about how the business is doing.
//
// So: smooth the metrics over several periods, weight the signals by what they
// are and how bad they are, and let a company with neither sit at neutral.
// Neutral is the honest answer for most of a portfolio at any moment, not an
// edge case to be engineered around.
//
// Pure and tested, computed on read and never stored: it is derived, like MOIC.

export type Trend = "VERY_DOWN" | "DOWN" | "NEUTRAL" | "UP" | "VERY_UP";

export interface TrendMetric {
  key: string;
  value: number;
  /// When it was reported, which orders the series.
  at: Date;
}

export interface TrendSignal {
  kind: string;
  severity: string;
  direction: string;
  /// The deterministic kind, for a derived signal: SILENCE, DOWN_ROUND and so
  /// on. Null for anything a model extracted.
  derivedKind?: string | null;
  /// When the thing happened, which is the date of the email it came from and
  /// NOT when the row was written. Every signal in this database was written
  /// the day extraction first ran, so a recency window over row age would
  /// include a two-year-old risk and exclude nothing.
  at: Date;
}

export interface TrendEvidence {
  label: string;
  /// Signed contribution, for showing the reader why.
  weight: number;
}

export interface TrendResult {
  trend: Trend;
  score: number;
  evidence: TrendEvidence[];
}

/// Signals older than this say nothing about where a company is now. Matches
/// the silence threshold, so the two agree about what counts as current.
const RECENCY_DAYS = 90;

/// How many reported points feed the smoothing. Four points give three
/// period-on-period changes, enough to survive one outlier month.
const SERIES_POINTS = 4;

const SEVERITY_WEIGHT: Record<string, number> = {
  LOW: 0.5,
  MEDIUM: 1,
  HIGH: 1.5,
  CRITICAL: 2,
};

/// What a signal is worth before severity scales it. Positive numbers are good
/// news; the sign is flipped for a NEGATIVE direction.
const KIND_WEIGHT: Record<string, number> = {
  FUNDRAISE: 1.5,
  PARTNERSHIP: 1,
  MILESTONE: 0.8,
  PERSONNEL_CHANGE: 0.8,
  // A risk is bad by definition, whatever direction the extraction assigned.
  RISK: -1,
  // An ask is a request of the reader, not news about the business.
  ASK: 0,
};

/// Deterministic signals carry their own meaning, so they bypass direction.
/// UNFILED_MAIL is deliberately absent: it reports that this app failed to file
/// an email, which is not a fact about the company.
const DERIVED_WEIGHT: Record<string, number> = {
  // Alone, enough to reach the bottom bucket: a priced round below the last one
  // is the clearest bad news a portfolio company can produce.
  DOWN_ROUND: -3,
  SILENCE: -1,
  RUNWAY_LOW: -1,
  MATURITY_APPROACHING: 0,
  QSBS_APPROACHING: 0,
  QSBS_REACHED: 0,
};

/// Signals are capped so a talkative founder cannot outweigh the numbers, and
/// so one catastrophe is not diluted by a dozen small wins. Set level with the
/// quantitative maximum, since neither kind of evidence should be able to
/// decide the answer alone.
const SIGNAL_CAP = 2.5;

/// Each further signal of the same sign counts for half the one before it.
///
/// Without this the score measures how much a founder writes: Bravi posts
/// twenty-five signals a quarter and saturated the cap on volume alone, which
/// would have read identically for a company with one real win and a habit of
/// listing it twenty times. Decaying by magnitude means the largest piece of
/// good and bad news dominates and the rest only colours it.
const REPEAT_DECAY = 0.5;

/// Metrics that describe the business getting bigger. Cash and burn are
/// deliberately absent: burn rising is not bad on its own, and reading it as
/// bad would penalise a company for spending a raise.
const GROWTH_KEYS = ["ARR", "MRR", "REVENUE"];

function daysBetween(from: Date, to: Date): number {
  return (to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000);
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

/// Average period-on-period change across the tail of a series, as a
/// percentage. Null when there is not enough to compare.
function smoothedGrowth(points: TrendMetric[]): number | null {
  if (points.length < 2) return null;

  const tail = [...points].sort((a, b) => a.at.getTime() - b.at.getTime()).slice(-SERIES_POINTS);
  const changes: number[] = [];

  for (let index = 1; index < tail.length; index += 1) {
    const previous = tail[index - 1]!.value;
    const current = tail[index]!.value;
    // A series that starts at zero has no percentage to report.
    if (previous <= 0) continue;
    changes.push(((current - previous) / previous) * 100);
  }

  if (changes.length === 0) return null;
  return changes.reduce((total, change) => total + change, 0) / changes.length;
}

/// Growth to a score in [-2, 2]. The bands are deliberately wide: a startup
/// posting 5% a month is doing well, and anything under a few percent either
/// way is noise rather than a trajectory.
function growthScore(percent: number): number {
  if (percent >= 15) return 2;
  if (percent >= 5) return 1;
  if (percent > -5) return 0;
  if (percent > -15) return -1;
  return -2;
}

function signalWeight(signal: TrendSignal): number {
  const severity = SEVERITY_WEIGHT[signal.severity] ?? 1;

  if (signal.derivedKind) {
    return (DERIVED_WEIGHT[signal.derivedKind] ?? 0) * severity;
  }

  const base = KIND_WEIGHT[signal.kind] ?? 0;
  if (base === 0) return 0;

  // A risk is negative whatever it says; everything else takes its sign from
  // the direction, and says nothing at all without one.
  if (signal.kind === "RISK") return base * severity;
  if (signal.direction === "POSITIVE") return base * severity;
  if (signal.direction === "NEGATIVE") return -base * severity;
  return 0;
}

/// Sums magnitudes largest first, halving each time. Bounded at twice the
/// largest, so the strongest signal sets the scale and the rest adjust it.
function decayedSum(magnitudes: number[]): number {
  return [...magnitudes]
    .sort((a, b) => b - a)
    .reduce((total, magnitude, index) => total + magnitude * REPEAT_DECAY ** index, 0);
}

/// The extremes want agreement from both kinds of evidence, or one of them at
/// its limit. Everything within a point of zero is noise, and saying so is more
/// useful than manufacturing a direction from nothing.
function bucket(score: number): Trend {
  if (score >= 2.5) return "VERY_UP";
  if (score >= 0.9) return "UP";
  if (score > -0.9) return "NEUTRAL";
  if (score > -2.5) return "DOWN";
  return "VERY_DOWN";
}

export interface TrendInput {
  metrics: TrendMetric[];
  signals: TrendSignal[];
}

export function computeTrend(input: TrendInput, asOf: Date): TrendResult {
  const evidence: TrendEvidence[] = [];

  // Revenue first, then customers as a weaker stand-in, plus any growth rate
  // the founder stated. Averaged rather than summed, so a company reporting
  // three series is not scored three times.
  const revenue = input.metrics.filter((metric) => GROWTH_KEYS.includes(metric.key));
  const customers = input.metrics.filter((metric) => metric.key === "CUSTOMERS");
  const stated = input.metrics.filter((metric) => metric.key === "GROWTH_RATE");

  const parts: Array<{ score: number; weight: number }> = [];

  const revenueGrowth = smoothedGrowth(revenue);
  if (revenueGrowth !== null) {
    parts.push({ score: growthScore(revenueGrowth), weight: 1 });
    evidence.push({
      label: `Revenue ${revenueGrowth >= 0 ? "up" : "down"} ${Math.abs(revenueGrowth).toFixed(1)}% a period`,
      weight: growthScore(revenueGrowth),
    });
  }

  // Already a percentage, so it is averaged rather than differenced.
  const statedTail = [...stated]
    .sort((a, b) => a.at.getTime() - b.at.getTime())
    .slice(-3)
    .map((metric) => metric.value);
  if (statedTail.length > 0) {
    const average = statedTail.reduce((total, value) => total + value, 0) / statedTail.length;
    parts.push({ score: growthScore(average), weight: 1 });
    evidence.push({
      label: `Reported growth averaging ${average.toFixed(1)}%`,
      weight: growthScore(average),
    });
  }

  const customerGrowth = smoothedGrowth(customers);
  if (customerGrowth !== null) {
    parts.push({ score: growthScore(customerGrowth), weight: 0.5 });
    evidence.push({
      label: `Customers ${customerGrowth >= 0 ? "up" : "down"} ${Math.abs(customerGrowth).toFixed(1)}% a period`,
      weight: growthScore(customerGrowth) * 0.5,
    });
  }

  const totalWeight = parts.reduce((total, part) => total + part.weight, 0);
  const quantitative =
    totalWeight > 0
      ? parts.reduce((total, part) => total + part.score * part.weight, 0) / totalWeight
      : 0;

  const recent = input.signals.filter(
    (signal) => daysBetween(signal.at, asOf) <= RECENCY_DAYS && daysBetween(signal.at, asOf) >= 0,
  );

  const weighted = recent
    .map((signal) => ({
      weight: signalWeight(signal),
      label: `${signal.derivedKind ?? signal.kind} (${signal.severity.toLowerCase()})`,
    }))
    .filter((entry) => entry.weight !== 0);

  evidence.push(...weighted);

  const qualitative = clamp(
    decayedSum(weighted.filter((entry) => entry.weight > 0).map((entry) => entry.weight)) -
      decayedSum(
        weighted.filter((entry) => entry.weight < 0).map((entry) => Math.abs(entry.weight)),
      ),
    -SIGNAL_CAP,
    SIGNAL_CAP,
  );

  const score = quantitative + qualitative;

  return {
    trend: bucket(score),
    score: Math.round(score * 100) / 100,
    // Loudest first, so a detail page can show the three that mattered.
    evidence: evidence
      .filter((entry) => entry.weight !== 0)
      .sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight)),
  };
}

export const TREND_LABEL: Record<Trend, string> = {
  VERY_DOWN: "Very Down",
  DOWN: "Down",
  NEUTRAL: "Neutral",
  UP: "Up",
  VERY_UP: "Very Up",
};
