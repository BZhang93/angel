import { describe, expect, it } from "vitest";
import {
  costBasis,
  irr,
  moic,
  totalDeployed,
  totalRealized,
  unrealizedValue,
  type Cashflow,
} from "./portfolio";

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

describe("cash totals", () => {
  const flows: Cashflow[] = [
    { kind: "INVESTMENT", amount: 25000, date: d("2022-03-01") },
    { kind: "INVESTMENT", amount: 10000, date: d("2023-06-01") },
    { kind: "FEE", amount: 500, date: d("2023-06-01") },
    { kind: "DISTRIBUTION", amount: 4000, date: d("2025-01-01") },
  ];

  it("counts fees as deployed but not as cost basis", () => {
    expect(totalDeployed(flows)).toBe(35500);
    expect(costBasis(flows)).toBe(35000);
  });

  it("sums realized proceeds", () => {
    expect(totalRealized(flows)).toBe(4000);
  });
});

describe("unrealizedValue", () => {
  const safe: Cashflow[] = [{ kind: "INVESTMENT", amount: 25000, date: d("2022-03-01") }];

  it("carries an unconverted SAFE at cost", () => {
    expect(unrealizedValue(safe, {})).toBe(25000);
  });

  it("carries fees as part of cost, since they were paid", () => {
    const withFees: Cashflow[] = [...safe, { kind: "FEE", amount: 2500, date: d("2022-03-01") }];
    expect(unrealizedValue(withFees, {})).toBe(27500);
  });

  it("marks priced equity to shares times latest price", () => {
    expect(unrealizedValue(safe, { shareCount: 10000, latestPricePerShare: 4.25 })).toBe(42500);
  });

  it("marks a dead company to zero even with a stale price", () => {
    expect(
      unrealizedValue(safe, {
        shareCount: 10000,
        latestPricePerShare: 4.25,
        companyIsDead: true,
      }),
    ).toBe(0);
  });

  it("marks a written-off position to zero", () => {
    const written: Cashflow[] = [...safe, { kind: "WRITE_OFF", amount: 0, date: d("2025-12-31") }];
    expect(unrealizedValue(written, {})).toBe(0);
  });

  it("nets a partial secondary out of a cost-carried position", () => {
    const partial: Cashflow[] = [
      ...safe,
      { kind: "SECONDARY_SALE", amount: 10000, date: d("2025-05-01") },
    ];
    expect(unrealizedValue(partial, {})).toBe(15000);
  });
});

describe("moic", () => {
  it("is null when nothing has been deployed", () => {
    expect(moic([], {})).toBeNull();
  });

  it("counts realized plus unrealized over everything put in", () => {
    // 25k in, 10k already back, 60k still held: 70k / 25k = 2.8x
    const flows: Cashflow[] = [
      { kind: "INVESTMENT", amount: 25000, date: d("2022-03-01") },
      { kind: "SECONDARY_SALE", amount: 10000, date: d("2025-05-01") },
    ];
    expect(moic(flows, { shareCount: 12000, latestPricePerShare: 5 })).toBe(2.8);
  });

  it("reads 1.00x at inception, fees and all", () => {
    // A position created today has neither gained nor lost. Carrying at the
    // fee-free basis against gross deployed used to report 0.91x on day one.
    const flows: Cashflow[] = [
      { kind: "INVESTMENT", amount: 10000, date: d("2022-03-01") },
      { kind: "FEE", amount: 1000, date: d("2022-03-01") },
    ];
    expect(moic(flows, {})).toBe(1);
  });

  it("still shows the drag once a real mark exists", () => {
    // Fees bought no ownership: once the position is marked at what the shares
    // are worth, the fee reduces the multiple.
    const flows: Cashflow[] = [
      { kind: "INVESTMENT", amount: 10000, date: d("2022-03-01") },
      { kind: "FEE", amount: 1000, date: d("2022-03-01") },
    ];
    expect(moic(flows, { shareCount: 10000, latestPricePerShare: 1 })).toBe(0.9091);
  });
});

describe("irr", () => {
  it("returns a doubling over four years as roughly 19%", () => {
    const flows: Cashflow[] = [{ kind: "INVESTMENT", amount: 50000, date: d("2021-01-01") }];
    const rate = irr(flows, { asOf: d("2025-01-01"), residualValue: 100000 });
    expect(rate).not.toBeNull();
    expect(rate!).toBeGreaterThan(0.18);
    expect(rate!).toBeLessThan(0.2);
  });

  it("is negative for a write-off", () => {
    const flows: Cashflow[] = [
      { kind: "INVESTMENT", amount: 50000, date: d("2021-01-01") },
      { kind: "DISTRIBUTION", amount: 5000, date: d("2025-01-01") },
    ];
    const rate = irr(flows, { asOf: d("2025-01-01"), residualValue: 0 });
    expect(rate!).toBeLessThan(-0.3);
  });

  it("is null when money has only ever gone out", () => {
    const flows: Cashflow[] = [{ kind: "INVESTMENT", amount: 50000, date: d("2021-01-01") }];
    expect(irr(flows, { asOf: d("2025-01-01"), residualValue: 0 })).toBeNull();
  });

  it("handles a SAFE that converted and then partially sold", () => {
    const flows: Cashflow[] = [
      { kind: "INVESTMENT", amount: 25000, date: d("2020-06-01") },
      { kind: "SECONDARY_SALE", amount: 40000, date: d("2024-06-01") },
    ];
    // 25k in mid-2020, 40k out mid-2024, 30k still held mid-2026: ~24%.
    const rate = irr(flows, { asOf: d("2026-06-01"), residualValue: 30000 });
    expect(rate).not.toBeNull();
    expect(rate!).toBeGreaterThan(0.23);
    expect(rate!).toBeLessThan(0.26);
  });
});
