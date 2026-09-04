import { describe, expect, it } from "vitest";
import { closestByDate, reconcilePayment, type RecordedPosition } from "./reconcile";

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

const position = (over: Partial<RecordedPosition> = {}): RecordedPosition => ({
  id: "p1",
  invested: 3000,
  fees: 0,
  investmentDate: d("2026-09-03"),
  ...over,
});

describe("reconcilePayment", () => {
  it("confirms a transfer that matches the recorded investment", () => {
    const verdict = reconcilePayment({ amount: 3000, valueDate: d("2026-09-03") }, [position()]);
    expect(verdict.kind).toBe("CONFIRMED");
  });

  it("confirms a transfer that bundles legal fees, and says what they were", () => {
    // The Viaka case: $3,000 committed, $283.50 legal fees, one wire.
    const verdict = reconcilePayment({ amount: 3283.5, valueDate: d("2026-09-03") }, [position()]);
    expect(verdict.kind).toBe("CONFIRMED_WITH_FEES");
    if (verdict.kind === "CONFIRMED_WITH_FEES") {
      expect(verdict.impliedFees).toBe(283.5);
      expect(verdict.note).toContain("$283.50");
    }
  });

  it("confirms when the fees are already recorded, without double counting", () => {
    const verdict = reconcilePayment({ amount: 3283.5, valueDate: d("2026-09-03") }, [
      position({ fees: 283.5 }),
    ]);
    expect(verdict.kind).toBe("CONFIRMED");
    if (verdict.kind === "CONFIRMED") expect(verdict.note).toContain("recorded fees");
  });

  it("flags a difference too large to be fees", () => {
    const verdict = reconcilePayment({ amount: 30500, valueDate: d("2026-09-03") }, [position()]);
    expect(verdict.kind).toBe("DISCREPANCY");
    if (verdict.kind === "DISCREPANCY") expect(verdict.difference).toBe(27500);
  });

  it("flags a transfer smaller than what was recorded", () => {
    const verdict = reconcilePayment({ amount: 1500, valueDate: d("2026-09-03") }, [position()]);
    expect(verdict.kind).toBe("DISCREPANCY");
  });

  it("tolerates rounding of a cent or two", () => {
    expect(reconcilePayment({ amount: 3000.01, valueDate: d("2026-09-03") }, [position()]).kind).toBe(
      "CONFIRMED",
    );
  });

  it("suggests an amount when nothing is recorded, net of stated fees", () => {
    const verdict = reconcilePayment({ amount: 3283.5, valueDate: d("2026-09-03") }, [], {
      knownFees: 283.5,
    });
    expect(verdict.kind).toBe("NO_POSITION");
    if (verdict.kind === "NO_POSITION") expect(verdict.suggestedInvestment).toBe(3000);
  });

  it("does not invent a net amount when no fees are known", () => {
    const verdict = reconcilePayment({ amount: 3283.5, valueDate: d("2026-09-03") }, []);
    if (verdict.kind === "NO_POSITION") {
      expect(verdict.suggestedInvestment).toBe(3283.5);
      expect(verdict.note).toContain("may include fees");
    }
  });

  it("reconciles against the position closest in time", () => {
    const positions = [
      position({ id: "old", invested: 10000, investmentDate: d("2021-01-01") }),
      position({ id: "new", invested: 3000, investmentDate: d("2026-09-01") }),
    ];
    const verdict = reconcilePayment({ amount: 3000, valueDate: d("2026-09-03") }, positions);
    expect(verdict.kind).toBe("CONFIRMED");
    if (verdict.kind === "CONFIRMED") expect(verdict.positionId).toBe("new");
  });
});

describe("closestByDate", () => {
  it("returns null with nothing to choose from", () => {
    expect(closestByDate([], d("2026-01-01"))).toBeNull();
  });
});
