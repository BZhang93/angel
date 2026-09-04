import { describe, expect, it } from "vitest";
import { chooseTargetPosition, gapsOnly } from "./fill";

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

describe("chooseTargetPosition", () => {
  const positions = [
    { id: "safe-2021", investmentDate: d("2021-04-15") },
    { id: "equity-2023", investmentDate: d("2023-09-01") },
  ];

  it("takes the only position when there is one", () => {
    expect(chooseTargetPosition([positions[0]!], { investmentDate: null })?.id).toBe("safe-2021");
  });

  it("picks the position nearest the document's date", () => {
    expect(chooseTargetPosition(positions, { investmentDate: "2023-08-20" })?.id).toBe("equity-2023");
    expect(chooseTargetPosition(positions, { investmentDate: "2021-05-01" })?.id).toBe("safe-2021");
  });

  it("refuses to guess between several positions with no date", () => {
    expect(chooseTargetPosition(positions, { investmentDate: null })).toBeNull();
  });

  it("returns null when the company has no positions", () => {
    expect(chooseTargetPosition([], { investmentDate: "2023-01-01" })).toBeNull();
  });
});

describe("gapsOnly", () => {
  it("fills empty fields and leaves existing values alone", () => {
    const current = { valuationCap: 8_000_000, discountPct: null, shareClass: null };
    const patch = gapsOnly(current, {
      valuationCap: 6_000_000,
      discountPct: 20,
      shareClass: "Series A",
    });

    expect(patch).toEqual({ discountPct: 20, shareClass: "Series A" });
    expect(patch).not.toHaveProperty("valuationCap");
  });

  it("ignores nulls in the incoming document", () => {
    expect(gapsOnly({ discountPct: null }, { discountPct: null })).toEqual({});
  });

  it("treats a stored zero as a real value, not a gap", () => {
    expect(gapsOnly({ discountPct: 0 }, { discountPct: 20 })).toEqual({});
  });
});
