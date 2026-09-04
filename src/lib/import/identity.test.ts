import { describe, expect, it } from "vitest";
import {
  canonicalCompanyKey,
  findExistingCompany,
  normalizeCompanyName,
  type ExistingCompany,
} from "./identity";

describe("normalizeCompanyName", () => {
  it("strips punctuation, case and legal suffixes", () => {
    expect(normalizeCompanyName("Bravi, Inc.")).toBe("bravi");
    expect(normalizeCompanyName("bravi")).toBe("bravi");
    expect(normalizeCompanyName("Acme Robotics LLC")).toBe("acme robotics");
    expect(normalizeCompanyName("Zephyr Health Ltd")).toBe("zephyr health");
  });

  it("never strips a name down to nothing", () => {
    expect(normalizeCompanyName("Co")).toBe("co");
  });

  it("keeps distinct companies distinct", () => {
    expect(normalizeCompanyName("Acme Robotics")).not.toBe(normalizeCompanyName("Acme Health"));
  });
});

describe("findExistingCompany", () => {
  const existing: ExistingCompany[] = [
    { id: "bravi", name: "Bravi", website: "https://bravi.app" },
    { id: "acme", name: "Acme Robotics LLC", website: null },
  ];

  it("matches on website domain whatever the name says", () => {
    const match = findExistingCompany(
      { name: "Bravi Technologies", website: "https://www.bravi.app/about" },
      existing,
    );
    expect(match).toMatchObject({ reason: "domain" });
    expect(match!.company.id).toBe("bravi");
  });

  it("matches on the normalised name when there is no domain", () => {
    const match = findExistingCompany({ name: "Acme Robotics, Inc.", website: null }, existing);
    expect(match).toMatchObject({ reason: "name" });
    expect(match!.company.id).toBe("acme");
  });

  it("returns null for a genuinely new company", () => {
    expect(findExistingCompany({ name: "Northwind Labs", website: null }, existing)).toBeNull();
  });

  it("never treats a syndicate or bank domain as company identity", () => {
    // The bug this guards: proposals fell back to the sender's domain, so every
    // company a syndicate emailed about shared a "website" and merged into one.
    const portfolio: ExistingCompany[] = [
      { id: "asendia", name: "Asendia AI", website: "https://viaka.net" },
    ];
    expect(findExistingCompany({ name: "Pintours", website: "https://viaka.net" }, portfolio)).toBeNull();
    expect(
      findExistingCompany(
        { name: "Saile", website: "https://mail.transfers.bankofamerica.com" },
        [{ id: "pintours", name: "Pintours", website: "https://mail.transfers.bankofamerica.com" }],
      ),
    ).toBeNull();
  });

  it("still merges two records of the same company by name", () => {
    // Pintours arriving from viaka.net and from the bank is one company.
    const portfolio: ExistingCompany[] = [{ id: "pintours", name: "Pintours", website: null }];
    expect(
      findExistingCompany({ name: "Pintours", website: "https://viaka.net" }, portfolio),
    ).toMatchObject({ reason: "name" });
  });

  it("prefers a domain match over a name match", () => {
    const both: ExistingCompany[] = [
      { id: "by-name", name: "Bravi", website: null },
      { id: "by-domain", name: "Something Else", website: "https://bravi.app" },
    ];
    expect(findExistingCompany({ name: "Bravi", website: "https://bravi.app" }, both)!.company.id).toBe(
      "by-domain",
    );
  });
});

describe("canonicalCompanyKey", () => {
  it("collapses the variants one company is written as", () => {
    expect(canonicalCompanyKey("Asendia AI")).toBe("asendia");
    expect(canonicalCompanyKey("Asendia")).toBe("asendia");
    expect(canonicalCompanyKey("Zaqa AI")).toBe(canonicalCompanyKey("Zaqa"));
    expect(canonicalCompanyKey("Bravi, Inc.")).toBe("bravi");
  });

  it("strips the vehicle wrapper a subscription document is issued under", () => {
    expect(canonicalCompanyKey("Viaka Asendia AI 2026, LLC", { vehicle: "Viaka" })).toBe("asendia");
    expect(canonicalCompanyKey("Viaka Pintours 2026 LLC", { vehicle: "Viaka" })).toBe("pintours");
    expect(canonicalCompanyKey("Viaka Marr Labs 2026, LLC", { vehicle: "Viaka" })).toBe("marr labs");
  });

  it("keeps distinct companies distinct", () => {
    expect(canonicalCompanyKey("Marr Labs")).not.toBe(canonicalCompanyKey("Marr Health"));
    expect(canonicalCompanyKey("Vessel")).not.toBe(canonicalCompanyKey("Saile"));
  });

  it("never strips a name to nothing", () => {
    expect(canonicalCompanyKey("AI")).toBe("ai");
    expect(canonicalCompanyKey("Fund")).toBe("fund");
  });
});
