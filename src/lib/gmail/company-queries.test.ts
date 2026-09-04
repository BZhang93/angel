import { describe, expect, it } from "vitest";
import {
  buildUpdateQueries,
  domainOfWebsite,
  senderTermsFor,
  type CompanySender,
} from "./company-queries";

const company = (over: Partial<CompanySender> = {}): CompanySender => ({
  companyId: "c1",
  name: "Acme Robotics",
  website: "https://www.acme.com/about",
  contactEmails: [],
  ...over,
});

describe("domainOfWebsite", () => {
  it("reduces a URL to a bare host", () => {
    expect(domainOfWebsite("https://www.acme.com/about")).toBe("acme.com");
    expect(domainOfWebsite(null)).toBeNull();
  });
});

describe("senderTermsFor", () => {
  it("uses the domain, which already covers every address on it", () => {
    expect(senderTermsFor(company({ contactEmails: ["jane@acme.com"] }))).toEqual(["from:acme.com"]);
  });

  it("adds contacts that sit outside the company domain", () => {
    const terms = senderTermsFor(company({ contactEmails: ["jane@gmail.com"] }));
    expect(terms).toEqual(["from:acme.com", "from:jane@gmail.com"]);
  });

  it("returns nothing for a company with no website and no contacts", () => {
    expect(senderTermsFor(company({ website: null }))).toEqual([]);
  });

  it("ignores malformed contact addresses", () => {
    expect(senderTermsFor(company({ website: null, contactEmails: ["not-an-address"] }))).toEqual([]);
  });
});

describe("buildUpdateQueries", () => {
  it("bounds the search by age", () => {
    expect(buildUpdateQueries([company()], { sinceDays: 180 })).toEqual([
      "(from:acme.com) newer_than:180d",
    ]);
  });

  it("batches so no single query grows unbounded", () => {
    const many = Array.from({ length: 25 }, (_, index) =>
      company({ companyId: `c${index}`, website: `https://c${index}.com` }),
    );
    const queries = buildUpdateQueries(many, { batchSize: 10 });

    expect(queries).toHaveLength(3);
    expect(queries[0]!.split(" OR ")).toHaveLength(10);
  });

  it("returns no queries when nothing is searchable, rather than one that matches everything", () => {
    expect(buildUpdateQueries([company({ website: null })])).toEqual([]);
    expect(buildUpdateQueries([])).toEqual([]);
  });
});
