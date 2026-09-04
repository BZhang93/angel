import { describe, expect, it } from "vitest";
import {
  addYears,
  deriveCompanySignals,
  downRoundSignal,
  maturitySignal,
  qsbsSignal,
  runwaySignal,
  silenceSignal,
} from "./signals";

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const NOW = d("2026-09-03");

describe("silenceSignal", () => {
  it("stays quiet inside 90 days", () => {
    expect(silenceSignal(d("2026-07-01"), NOW)).toBeNull();
  });

  it("escalates from medium to critical", () => {
    expect(silenceSignal(d("2026-05-01"), NOW)?.severity).toBe("MEDIUM");
    expect(silenceSignal(d("2026-01-01"), NOW)?.severity).toBe("HIGH");
    expect(silenceSignal(d("2025-01-01"), NOW)?.severity).toBe("CRITICAL");
  });

  it("measures from the investment date when no update ever arrived", () => {
    const signal = silenceSignal(null, NOW, { firstInvestmentAt: d("2025-01-01") });
    expect(signal?.severity).toBe("CRITICAL");
    expect(signal?.summary).toContain("ever received");
  });

  it("says nothing about a company with no updates and no investment date", () => {
    expect(silenceSignal(null, NOW)).toBeNull();
  });
});

describe("runwaySignal", () => {
  it("is silent above six months and escalates below", () => {
    expect(runwaySignal(9)).toBeNull();
    expect(runwaySignal(6)?.severity).toBe("HIGH");
    expect(runwaySignal(2)?.severity).toBe("CRITICAL");
    expect(runwaySignal(null)).toBeNull();
  });
});

describe("maturitySignal", () => {
  it("warns inside 90 days and escalates once past due", () => {
    expect(maturitySignal(d("2027-01-01"), NOW)).toBeNull();
    expect(maturitySignal(d("2026-10-01"), NOW)?.severity).toBe("MEDIUM");

    const overdue = maturitySignal(d("2026-06-01"), NOW);
    expect(overdue?.severity).toBe("HIGH");
    expect(overdue?.summary).toContain("matured");
  });
});

describe("qsbsSignal", () => {
  it("ignores ineligible positions", () => {
    expect(qsbsSignal(d("2022-01-01"), false, NOW)).toBeNull();
  });

  it("warns within 180 days of the five-year date", () => {
    const signal = qsbsSignal(d("2021-12-01"), true, NOW);
    expect(signal?.kind).toBe("QSBS_APPROACHING");
    expect(signal?.summary).toContain("Do not sell");
  });

  it("confirms once the five-year date has passed", () => {
    expect(qsbsSignal(d("2020-01-01"), true, NOW)?.kind).toBe("QSBS_REACHED");
  });

  it("counts five years from the investment date", () => {
    expect(addYears(d("2021-02-28"), 5).toISOString().slice(0, 10)).toBe("2026-02-28");
  });
});

describe("downRoundSignal", () => {
  it("needs two priced marks", () => {
    expect(downRoundSignal([{ date: d("2024-01-01"), postMoneyValuation: 20_000_000 }])).toBeNull();
  });

  it("ignores an up round", () => {
    expect(
      downRoundSignal([
        { date: d("2023-01-01"), postMoneyValuation: 20_000_000 },
        { date: d("2025-01-01"), postMoneyValuation: 60_000_000 },
      ]),
    ).toBeNull();
  });

  it("reports the drop and escalates past half", () => {
    const mild = downRoundSignal([
      { date: d("2023-01-01"), postMoneyValuation: 20_000_000 },
      { date: d("2025-01-01"), postMoneyValuation: 14_000_000 },
    ]);
    expect(mild?.severity).toBe("MEDIUM");
    expect(mild?.summary).toContain("30%");

    const severe = downRoundSignal([
      { date: d("2023-01-01"), postMoneyValuation: 20_000_000 },
      { date: d("2025-01-01"), postMoneyValuation: 5_000_000 },
    ]);
    expect(severe?.severity).toBe("HIGH");
  });

  it("compares the two latest marks by date, not by input order", () => {
    const signal = downRoundSignal([
      { date: d("2025-01-01"), postMoneyValuation: 10_000_000 },
      { date: d("2023-01-01"), postMoneyValuation: 20_000_000 },
    ]);
    expect(signal?.summary).toContain("50%");
  });
});

describe("deriveCompanySignals", () => {
  it("returns every applicable signal, most severe first", () => {
    const signals = deriveCompanySignals(
      {
        lastUpdateAt: d("2025-06-01"),
        firstInvestmentAt: d("2021-06-01"),
        runwayMonths: 5,
        maturityDates: [d("2026-10-15")],
        qsbsPositions: [{ investmentDate: d("2021-06-01"), qsbsEligible: true }],
        valuations: [],
      },
      NOW,
    );

    expect(signals.map((s) => s.kind)).toEqual([
      "SILENCE",
      "RUNWAY_LOW",
      "MATURITY_APPROACHING",
      "QSBS_REACHED",
    ]);
    expect(signals[0]!.severity).toBe("CRITICAL");
  });

  it("is empty for a healthy, recently updated company", () => {
    expect(
      deriveCompanySignals(
        {
          lastUpdateAt: d("2026-08-15"),
          firstInvestmentAt: d("2025-01-01"),
          runwayMonths: 24,
          maturityDates: [],
          qsbsPositions: [],
          valuations: [],
        },
        NOW,
      ),
    ).toEqual([]);
  });
});

describe("silenceSignal with unfiled mail", () => {
  it("does not claim silence when recent mail mentions the company", () => {
    // Vessel: nothing filed since Aug 2025, but six emails mention it, the
    // newest a week old. Calling that 388 days of silence blamed the founder
    // for a filing failure.
    const signal = silenceSignal(d("2025-08-11"), NOW, {
      unfiledMentions: { count: 6, latest: d("2026-08-28") },
    });
    expect(signal?.kind).toBe("UNFILED_MAIL");
    expect(signal?.severity).toBe("LOW");
    expect(signal?.summary).toContain("review queue");
  });

  it("still reports silence when the unfiled mail is itself old", () => {
    const signal = silenceSignal(d("2025-01-01"), NOW, {
      unfiledMentions: { count: 2, latest: d("2025-06-01") },
    });
    expect(signal?.kind).toBe("SILENCE");
    expect(signal?.severity).toBe("CRITICAL");
  });

  it("is unaffected when nothing mentions the company", () => {
    expect(
      silenceSignal(d("2025-01-01"), NOW, { unfiledMentions: { count: 0, latest: null } })?.kind,
    ).toBe("SILENCE");
  });
});
