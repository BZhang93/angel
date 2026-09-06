import { describe, expect, it } from "vitest";
import { computeTrend, type TrendMetric, type TrendSignal } from "./trend";

const NOW = new Date("2026-09-05T00:00:00Z");

function at(month: string): Date {
  return new Date(`2026-${month}-15T00:00:00Z`);
}

function metric(key: string, value: number, month: string): TrendMetric {
  return { key, value, at: at(month) };
}

function signal(
  kind: string,
  severity: string,
  direction: string,
  extra: Partial<TrendSignal> = {},
): TrendSignal {
  return { kind, severity, direction, at: at("08"), ...extra };
}

// Bravi's actual reported series, which is the only real one in the portfolio
// and the case the thresholds were calibrated against. Noisy on purpose: month
// on month growth swings from 4.1% to 33.3%.
const BRAVI: TrendMetric[] = [
  metric("ARR", 186_700, "03"),
  metric("ARR", 220_300, "04"),
  metric("ARR", 293_600, "05"),
  metric("ARR", 305_800, "06"),
  metric("ARR", 387_200, "07"),
  metric("ARR", 411_600, "09"),
  metric("GROWTH_RATE", 33.3, "05"),
  metric("GROWTH_RATE", 4.1, "06"),
  metric("GROWTH_RATE", 26.6, "07"),
  metric("CUSTOMERS", 14, "06"),
  metric("CUSTOMERS", 15, "07"),
  metric("CUSTOMERS", 16, "09"),
];

describe("computeTrend", () => {
  it("is neutral with nothing to go on, which is most of a portfolio", () => {
    const result = computeTrend({ metrics: [], signals: [] }, NOW);

    expect(result.trend).toBe("NEUTRAL");
    expect(result.score).toBe(0);
    expect(result.evidence).toEqual([]);
  });

  it("reads Bravi's real series as up, risks and all", () => {
    // Eight risks alongside a raise and nineteen positive milestones: an honest
    // investor update always lists problems, and doing so must not read as
    // decline while revenue is nearly doubling.
    const signals = [
      signal("FUNDRAISE", "MEDIUM", "POSITIVE"),
      signal("RISK", "HIGH", "NEGATIVE"),
      signal("RISK", "MEDIUM", "NEGATIVE"),
      signal("RISK", "MEDIUM", "NEGATIVE"),
      ...Array.from({ length: 6 }, () => signal("PARTNERSHIP", "LOW", "POSITIVE")),
      ...Array.from({ length: 12 }, () => signal("MILESTONE", "LOW", "POSITIVE")),
    ];

    expect(computeTrend({ metrics: BRAVI, signals }, NOW).trend).toBe("UP");
  });

  it("does not let a talkative founder outweigh the numbers", () => {
    // Twenty routine wins and flat revenue is not a company on a tear, and
    // should not read as one. Summed without decay these came to 8.0 and
    // saturated the cap, which made the score a measure of how much a founder
    // writes rather than of how the business is doing.
    const chatty = Array.from({ length: 20 }, () => signal("MILESTONE", "LOW", "POSITIVE"));
    const flat = [metric("ARR", 100_000, "06"), metric("ARR", 100_000, "07")];

    const result = computeTrend({ metrics: flat, signals: chatty }, NOW);

    expect(result.trend).toBe("NEUTRAL");
    expect(result.score).toBeLessThan(1);
  });

  it("lets one real win beat twenty small ones", () => {
    const chatty = Array.from({ length: 20 }, () => signal("MILESTONE", "LOW", "POSITIVE"));
    const raise = [signal("FUNDRAISE", "HIGH", "POSITIVE")];

    const many = computeTrend({ metrics: [], signals: chatty }, NOW);
    const one = computeTrend({ metrics: [], signals: raise }, NOW);

    expect(one.score).toBeGreaterThan(many.score);
  });

  it("treats a down round as the bottom of the scale on its own", () => {
    const result = computeTrend(
      { metrics: [], signals: [signal("RISK", "MEDIUM", "NEGATIVE", { derivedKind: "DOWN_ROUND" })] },
      NOW,
    );

    expect(result.trend).toBe("VERY_DOWN");
  });

  it("reads a critical silence as down", () => {
    const result = computeTrend(
      { metrics: [], signals: [signal("RISK", "CRITICAL", "NEGATIVE", { derivedKind: "SILENCE" })] },
      NOW,
    );

    expect(result.trend).toBe("DOWN");
  });

  it("pulls modest growth back to neutral when something is wrong", () => {
    const modest = [metric("ARR", 100_000, "06"), metric("ARR", 106_000, "07")];
    const result = computeTrend(
      { metrics: modest, signals: [signal("RISK", "HIGH", "NEGATIVE")] },
      NOW,
    );

    expect(result.trend).toBe("NEUTRAL");
  });

  it("counts a risk against a company however the extraction labelled it", () => {
    const neutral = computeTrend({ metrics: [], signals: [signal("RISK", "HIGH", "NEUTRAL")] }, NOW);
    expect(neutral.score).toBeLessThan(0);
  });

  it("ignores a signal with no direction, which is a row written before polarity existed", () => {
    const result = computeTrend(
      { metrics: [], signals: [signal("MILESTONE", "HIGH", "NEUTRAL")] },
      NOW,
    );

    expect(result.trend).toBe("NEUTRAL");
    expect(result.score).toBe(0);
  });

  it("ignores anything older than the recency window", () => {
    const old = signal("FUNDRAISE", "CRITICAL", "POSITIVE", { at: new Date("2025-01-01") });
    expect(computeTrend({ metrics: [], signals: [old] }, NOW).score).toBe(0);
  });

  it("never counts unfiled mail, which is this app's problem and not the company's", () => {
    const filing = signal("RISK", "CRITICAL", "NEGATIVE", { derivedKind: "UNFILED_MAIL" });
    expect(computeTrend({ metrics: [], signals: [filing] }, NOW).score).toBe(0);
  });

  it("reads falling revenue as down", () => {
    const falling = [
      metric("ARR", 400_000, "05"),
      metric("ARR", 330_000, "06"),
      metric("ARR", 260_000, "07"),
    ];

    expect(computeTrend({ metrics: falling, signals: [] }, NOW).trend).toBe("DOWN");
  });

  it("needs two points before it will call a direction", () => {
    const single = [metric("ARR", 400_000, "07")];
    expect(computeTrend({ metrics: single, signals: [] }, NOW).trend).toBe("NEUTRAL");
  });

  it("explains itself, loudest evidence first", () => {
    const result = computeTrend(
      { metrics: BRAVI, signals: [signal("RISK", "HIGH", "NEGATIVE")] },
      NOW,
    );

    expect(result.evidence[0]!.label).toContain("growth");
    expect(Math.abs(result.evidence[0]!.weight)).toBeGreaterThanOrEqual(
      Math.abs(result.evidence[1]!.weight),
    );
  });
});
