import { describe, expect, it } from "vitest";
import {
  domainOfAddress,
  evidenceFor,
  groupBySenderDomain,
  labelFromDomain,
  looksLikeCompanyName,
  type ScannedEmail,
} from "./group";

const email = (over: Partial<ScannedEmail> & { fromAddress: string }): ScannedEmail => ({
  gmailMessageId: Math.random().toString(36).slice(2),
  fromName: null,
  subject: null,
  receivedAt: new Date("2026-01-01T00:00:00.000Z"),
  text: "",
  ...over,
});

describe("domainOfAddress", () => {
  it("takes the part after the last @, lowercased", () => {
    expect(domainOfAddress("Jane@Acme.com")).toBe("acme.com");
    expect(domainOfAddress("not-an-address")).toBeNull();
  });
});

describe("labelFromDomain", () => {
  it("reduces a domain to a readable label", () => {
    expect(labelFromDomain("acmerobotics.com")).toBe("Acmerobotics");
    expect(labelFromDomain("mail.acme.co.uk")).toBe("Acme");
    expect(labelFromDomain("zephyr.io")).toBe("Zephyr");
  });
});

describe("looksLikeCompanyName", () => {
  it("rejects what reads as a person's name", () => {
    expect(looksLikeCompanyName("Jane Founder")).toBe(false);
    expect(looksLikeCompanyName(null)).toBe(false);
  });

  it("accepts corporate-sounding names", () => {
    expect(looksLikeCompanyName("Acme Robotics")).toBe(true);
    expect(looksLikeCompanyName("Zephyr Team")).toBe(true);
    expect(looksLikeCompanyName("Northwind Labs Inc")).toBe(true);
  });
});

describe("groupBySenderDomain", () => {
  const emails = [
    email({ fromAddress: "jane@acme.com", fromName: "Acme Robotics", receivedAt: new Date("2026-06-01") }),
    email({ fromAddress: "ops@acme.com", fromName: "Jane Founder", receivedAt: new Date("2026-07-01") }),
    email({ fromAddress: "hi@zephyr.io", receivedAt: new Date("2026-05-01") }),
    email({ fromAddress: "digest@substack.com" }),
    email({ fromAddress: "someone@gmail.com" }),
  ];

  it("groups by domain and drops consumer and bulk senders", () => {
    const groups = groupBySenderDomain(emails);
    expect(groups.map((group) => group.domain)).toEqual(["acme.com", "zephyr.io"]);
  });

  it("prefers a company-sounding display name over the domain label", () => {
    const [acme, zephyr] = groupBySenderDomain(emails);
    expect(acme!.guessedName).toBe("Acme Robotics");
    expect(zephyr!.guessedName).toBe("Zephyr");
  });

  it("skips domains already in the portfolio", () => {
    const groups = groupBySenderDomain(emails, { knownDomains: new Set(["acme.com"]) });
    expect(groups.map((group) => group.domain)).toEqual(["zephyr.io"]);
  });

  it("can require more than one email before proposing a company", () => {
    expect(groupBySenderDomain(emails, { minEmails: 2 }).map((g) => g.domain)).toEqual(["acme.com"]);
  });

  it("orders emails newest first within a group", () => {
    const [acme] = groupBySenderDomain(emails);
    expect(acme!.emails[0]!.receivedAt.toISOString().slice(0, 10)).toBe("2026-07-01");
  });
});

describe("evidenceFor", () => {
  it("returns everything when the group is small", () => {
    const group = groupBySenderDomain([
      email({ fromAddress: "a@acme.com" }),
      email({ fromAddress: "b@acme.com" }),
    ])[0]!;
    expect(evidenceFor(group)).toHaveLength(2);
  });

  it("keeps the newest few plus the oldest, where the terms usually live", () => {
    const many = Array.from({ length: 10 }, (_, index) =>
      email({
        fromAddress: "a@acme.com",
        subject: `mail ${index}`,
        receivedAt: new Date(2026, index, 1),
      }),
    );
    const group = groupBySenderDomain(many)[0]!;
    const evidence = evidenceFor(group, { maxEmails: 4 });

    expect(evidence).toHaveLength(4);
    expect(evidence[0]!.subject).toBe("mail 9");
    expect(evidence[3]!.subject).toBe("mail 0");
  });
});
