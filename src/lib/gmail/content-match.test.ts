import { describe, expect, it } from "vitest";
import {
  matchCompanyByContent,
  matchTokensFor,
  mentionsCompany,
  type NamedCompany,
} from "./content-match";

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

  it("refuses to file a note that names several companies nowhere in its subject", () => {
    expect(
      matchCompanyByContent("Updates on Asendia, Pintours and Bravi this quarter.", companies, {
        subject: "Q3 portfolio note",
      }),
    ).toBeNull();
  });

  it("files on a subject naming one company, whatever the body mentions", () => {
    // The real case: a monthly update whose footer lists the rest of the
    // portfolio was left unfiled, and the company then looked silent.
    const match = matchCompanyByContent(
      "Vessel had a strong month. Elsewhere in the portfolio, Asendia and Pintours also closed.",
      [...companies, { companyId: "vessel", name: "Vessel" }],
      { subject: "Viaka x Vessel SPV - August 2026 Update" },
    );
    expect(match).toMatchObject({ companyId: "vessel" });
    expect(match!.confidence).toBeGreaterThanOrEqual(0.85);
  });

  it("refuses a digest naming several companies in its subject", () => {
    expect(
      matchCompanyByContent("Everything this month.", companies, {
        subject: "Asendia, Pintours and Bravi: monthly digest",
      }),
    ).toBeNull();
  });

  it("returns null when no company is named", () => {
    expect(matchCompanyByContent("Your statement is ready.", companies, { subject: "Statement" })).toBeNull();
  });
});

describe("matchTokensFor", () => {
  it("offers the name as an email would actually write it", () => {
    expect(matchTokensFor("Asendia AI")).toEqual(["Asendia AI", "Asendia"]);
    expect(matchTokensFor("Marr Labs Inc")).toEqual(["Marr Labs Inc", "Marr Labs"]);
  });

  it("never shortens a name down to something generic", () => {
    expect(matchTokensFor("Health AI")).toEqual(["Health AI"]);
  });

  it("leaves a plain name alone", () => {
    expect(matchTokensFor("Pintours")).toEqual(["Pintours"]);
  });
});

describe("mentionsCompany with a shortened name", () => {
  it("matches the form the email uses", () => {
    // The real case: the subject says Asendia, the company is stored Asendia AI.
    expect(mentionsCompany("Wire instructions for Asendia SPV", "Asendia AI")).toBe(true);
    expect(mentionsCompany("Viaka Marr Labs 2026, LLC - Subscription Agreement", "Marr Labs")).toBe(
      true,
    );
  });

  it("still refuses a partial word", () => {
    expect(mentionsCompany("Asendian rugs on sale", "Asendia AI")).toBe(false);
  });
});
