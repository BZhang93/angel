import { describe, expect, it } from "vitest";
import { agreedValue, findDiscrepancies, needsReview, type Claim } from "./discrepancies";

describe("findDiscrepancies", () => {
  it("is quiet when every source agrees", () => {
    const claims: Claim[] = [
      { source: "EMAIL_COMMITMENT", kind: "INVESTMENT", amount: 3000 },
      { source: "DOCUMENT", kind: "INVESTMENT", amount: 3000 },
      { source: "DOCUMENT", kind: "FEE", amount: 283.5 },
      { source: "BANK_TRANSFER", kind: "TOTAL", amount: 3283.5 },
    ];
    expect(findDiscrepancies(claims)).toEqual([]);
    expect(needsReview(claims)).toBe(false);
  });

  it("names the source whose amount disagrees", () => {
    const claims: Claim[] = [
      { source: "DOCUMENT", kind: "INVESTMENT", amount: 3000 },
      { source: "EMAIL_COMMITMENT", kind: "INVESTMENT", amount: 30500 },
    ];
    const found = findDiscrepancies(claims);
    expect(found).toHaveLength(1);
    expect(found[0]!.label).toBe("The commitment email's amount does not match");
    expect(found[0]!.detail).toContain("$30,500.00");
    expect(found[0]!.detail).toContain("$3,000.00");
  });

  it("catches a wire that does not equal investment plus fees", () => {
    // The fee was bundled into the wire but never recorded.
    const claims: Claim[] = [
      { source: "DOCUMENT", kind: "INVESTMENT", amount: 3000 },
      { source: "BANK_TRANSFER", kind: "TOTAL", amount: 3283.5 },
    ];
    const found = findDiscrepancies(claims);
    expect(found).toHaveLength(1);
    expect(found[0]!.label).toBe("The bank transfer's total amount does not match");
    expect(found[0]!.detail).toContain("comes to $3,000.00");
  });

  it("uses DocuSign's wording when that is the source", () => {
    const found = findDiscrepancies([
      { source: "MANUAL", kind: "TOTAL", amount: 3000 },
      { source: "DOCUSIGN", kind: "TOTAL", amount: 3283.5 },
    ]);
    expect(found[0]!.label).toBe("DocuSign's total amount does not match");
  });

  it("tolerates rounding of a cent", () => {
    expect(
      findDiscrepancies([
        { source: "DOCUMENT", kind: "INVESTMENT", amount: 3000 },
        { source: "BANK_TRANSFER", kind: "INVESTMENT", amount: 3000.01 },
      ]),
    ).toEqual([]);
  });

  it("reports every disagreeing source, not just the first", () => {
    const found = findDiscrepancies([
      { source: "MANUAL", kind: "INVESTMENT", amount: 3000 },
      { source: "DOCUMENT", kind: "INVESTMENT", amount: 2500 },
      { source: "EMAIL_COMMITMENT", kind: "INVESTMENT", amount: 4000 },
    ]);
    expect(found.map((entry) => entry.source).sort()).toEqual(["DOCUMENT", "EMAIL_COMMITMENT"]);
  });

  it("says nothing about a single source", () => {
    expect(findDiscrepancies([{ source: "DOCUMENT", kind: "INVESTMENT", amount: 3000 }])).toEqual([]);
  });
});

describe("agreedValue", () => {
  it("prefers what the user entered over anything extracted", () => {
    const agreed = agreedValue(
      [
        { source: "DOCUMENT", kind: "INVESTMENT", amount: 2500 },
        { source: "MANUAL", kind: "INVESTMENT", amount: 3000 },
      ],
      "INVESTMENT",
    );
    expect(agreed).toMatchObject({ source: "MANUAL", amount: 3000 });
  });

  it("prefers a signed document over an email", () => {
    const agreed = agreedValue(
      [
        { source: "EMAIL_COMMITMENT", kind: "INVESTMENT", amount: 30500 },
        { source: "DOCUMENT", kind: "INVESTMENT", amount: 3000 },
      ],
      "INVESTMENT",
    );
    expect(agreed).toMatchObject({ source: "DOCUMENT" });
  });

  it("returns null for a kind nobody stated", () => {
    expect(agreedValue([{ source: "MANUAL", kind: "INVESTMENT", amount: 1 }], "FEE")).toBeNull();
  });
});
