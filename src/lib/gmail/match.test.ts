import { describe, expect, it } from "vitest";
import {
  AUTO_MATCH_THRESHOLD,
  bestMatch,
  domainOf,
  matchCompany,
  type MatchCandidate,
} from "./match";

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

describe("bestMatch", () => {
  it("takes the stronger reading, not the first one offered", () => {
    // The bug this exists for. A Viaka subject names the company, so the sender
    // rule always answered first with 0.6, which is under the auto-file
    // threshold. That suppressed a 0.95 content match and the email was
    // dropped: 135 of 169 unfiled emails were stuck behind it.
    const sender = { companyId: "a", confidence: 0.6, reason: "name" as const };
    const content = { companyId: "a", confidence: 0.95, matchedName: "Asendia" };

    expect(bestMatch(sender, content)?.confidence).toBe(0.95);
    expect(bestMatch(content, sender)?.confidence).toBe(0.95);
  });

  it("keeps a certain sender match over a weaker content one", () => {
    const sender = { companyId: "a", confidence: 1, reason: "contact" as const };
    const content = { companyId: "b", confidence: 0.85, matchedName: "Bravi" };

    expect(bestMatch(sender, content)?.companyId).toBe("a");
  });

  it("ignores nulls and returns null when nothing matched", () => {
    expect(bestMatch(null, undefined)).toBeNull();
    expect(bestMatch(null, { companyId: "a", confidence: 0.9 })?.companyId).toBe("a");
  });
});
