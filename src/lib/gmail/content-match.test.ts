import { describe, expect, it } from "vitest";
import { matchCompanyByContent, mentionsCompany, type NamedCompany } from "./content-match";

const companies: NamedCompany[] = [
  { companyId: "asendia", name: "Asendia" },
  { companyId: "pintours", name: "Pintours" },
  { companyId: "bravi", name: "Bravi" },
];

describe("mentionsCompany", () => {
  it("matches whole words only", () => {
    expect(mentionsCompany("Wire to Asendia completed", "Asendia")).toBe(true);
    expect(mentionsCompany("the crew was assailed by doubt", "Saile")).toBe(false);
    expect(mentionsCompany("Bravissimo Ltd invoice", "Bravi")).toBe(false);
  });

  it("ignores case", () => {
    expect(mentionsCompany("payment to ASENDIA INC", "Asendia")).toBe(true);
  });

  it("refuses names too generic to be evidence", () => {
    expect(mentionsCompany("our labs are open", "Labs")).toBe(false);
  });
});

describe("matchCompanyByContent", () => {
  it("files a DocuSign envelope that names one company", () => {
    const match = matchCompanyByContent(
      "You have completed signing Asendia SAFE Agreement.",
      companies,
      { subject: "Completed: Please DocuSign: Asendia SAFE.pdf" },
    );
    expect(match).toMatchObject({ companyId: "asendia" });
    expect(match!.confidence).toBeGreaterThanOrEqual(0.8);
  });

  it("is less certain when the name appears only in the body", () => {
    const match = matchCompanyByContent("Outgoing wire to Pintours Ltd.", companies, {
      subject: "Your transfer is complete",
    });
    expect(match).toMatchObject({ companyId: "pintours", confidence: 0.85 });
  });

  it("refuses to file a note that names several companies", () => {
    expect(
      matchCompanyByContent("Updates on Asendia, Pintours and Bravi this quarter.", companies, {
        subject: "Q3 portfolio note",
      }),
    ).toBeNull();
  });

  it("uses the subject to break a tie, but not confidently", () => {
    const match = matchCompanyByContent("Also mentions Pintours and Bravi.", companies, {
      subject: "Asendia wire confirmation",
    });
    expect(match).toMatchObject({ companyId: "asendia", confidence: 0.7 });
  });

  it("returns null when no company is named", () => {
    expect(matchCompanyByContent("Your statement is ready.", companies, { subject: "Statement" })).toBeNull();
  });
});
