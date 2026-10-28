import { describe, expect, it } from "vitest";
import { companyForAttachment, filenameText } from "./attachment-company";

const COMPANIES = [
  { companyId: "pintours", name: "Pintours" },
  { companyId: "marr", name: "Marr Labs" },
  { companyId: "saile", name: "Saile" },
];

describe("filenameText", () => {
  it("turns filename separators into word boundaries", () => {
    expect(filenameText("Viaka_Marr_Labs_2026,_LLC_-_Operating_Agreement.doc.pdf")).toBe(
      "Viaka Marr Labs 2026, LLC Operating Agreement doc pdf",
    );
  });
});

describe("companyForAttachment", () => {
  it("inherits the email's company when the filename names nothing", () => {
    expect(companyForAttachment("signed agreement.pdf", "pintours", COMPANIES)).toBe("pintours");
  });

  it("inherits when the filename names that same company", () => {
    expect(
      companyForAttachment("Complete_with_Docusign_Viaka_Pintours_2026_.pdf", "pintours", COMPANIES),
    ).toBe("pintours");
  });

  // The case this exists for: Marr Labs paperwork attached to the Pintours
  // closing email, which was filed under Pintours and reached its position.
  it("refuses to inherit when the filename names a different company", () => {
    expect(
      companyForAttachment(
        "Viaka Marr Labs 2026, LLC - Subscription Agreement (H. Azzam).docx.pdf",
        "pintours",
        COMPANIES,
      ),
    ).toBeNull();
  });

  it("inherits when the filename names the email's company alongside another", () => {
    expect(companyForAttachment("Pintours_and_Saile_summary.pdf", "pintours", COMPANIES)).toBe(
      "pintours",
    );
  });

  it("leaves an unmatched email's attachments unfiled", () => {
    expect(companyForAttachment("Marr_Labs_SAFE.pdf", null, COMPANIES)).toBeNull();
  });
});
