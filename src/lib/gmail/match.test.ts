import { describe, expect, it } from "vitest";
import { AUTO_MATCH_THRESHOLD, domainOf, matchCompany, type MatchCandidate } from "./match";

const candidates: MatchCandidate[] = [
  {
    companyId: "acme",
    name: "Acme Robotics",
    website: "https://www.acme.com/about",
    contactEmails: ["jane@acme.com"],
  },
  { companyId: "zephyr", name: "Zephyr", website: "zephyr.io", contactEmails: [] },
];

describe("domainOf", () => {
  it("normalises URLs and addresses to a bare host", () => {
    expect(domainOf("https://www.acme.com/about")).toBe("acme.com");
    expect(domainOf("jane@Acme.com")).toBe("acme.com");
    expect(domainOf(null)).toBeNull();
  });
});

describe("matchCompany", () => {
  it("matches a known contact address with full confidence", () => {
    const match = matchCompany({ fromAddress: "jane@acme.com", subject: "Update" }, candidates);
    expect(match).toEqual({ companyId: "acme", confidence: 1, reason: "contact" });
    expect(match!.confidence).toBeGreaterThanOrEqual(AUTO_MATCH_THRESHOLD);
  });

  it("matches an unknown sender at a known domain", () => {
    const match = matchCompany({ fromAddress: "ops@zephyr.io", subject: "Hello" }, candidates);
    expect(match).toMatchObject({ companyId: "zephyr", reason: "domain" });
    expect(match!.confidence).toBeGreaterThanOrEqual(AUTO_MATCH_THRESHOLD);
  });

  it("keeps a subject-line name match below the auto-assign threshold", () => {
    const match = matchCompany(
      { fromAddress: "updates@mailer.example", subject: "Acme Robotics Q2 update" },
      candidates,
    );
    expect(match).toMatchObject({ companyId: "acme", reason: "name" });
    expect(match!.confidence).toBeLessThan(AUTO_MATCH_THRESHOLD);
  });

  it("returns null when nothing matches", () => {
    expect(matchCompany({ fromAddress: "news@substack.com", subject: "Weekly" }, candidates)).toBeNull();
  });
});
