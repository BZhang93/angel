import { describe, expect, it } from "vitest";
import { baseDomain, isCompanyDomain } from "./domains";

describe("baseDomain", () => {
  it("reduces a host to its registrable domain", () => {
    expect(baseDomain("mail.transfers.bankofamerica.com")).toBe("bankofamerica.com");
    expect(baseDomain("acme.com")).toBe("acme.com");
    expect(baseDomain("shop.acme.co.uk")).toBe("acme.co.uk");
  });
});

describe("isCompanyDomain", () => {
  it("accepts an ordinary company domain", () => {
    expect(isCompanyDomain("acme.com")).toBe(true);
    expect(isCompanyDomain("www.bravi.app")).toBe(true);
  });

  it("rejects a bank, including its mail subdomains", () => {
    expect(isCompanyDomain("bankofamerica.com")).toBe(false);
    expect(isCompanyDomain("mail.transfers.bankofamerica.com")).toBe(false);
  });

  it("rejects syndicates and SPV platforms, which are vehicles not companies", () => {
    expect(isCompanyDomain("viaka.net")).toBe(false);
    expect(isCompanyDomain("angellist.com")).toBe(false);
    expect(isCompanyDomain("carta.com")).toBe(false);
  });

  it("rejects consumer mail and infrastructure hosts", () => {
    expect(isCompanyDomain("gmail.com")).toBe(false);
    expect(isCompanyDomain("notifications.acme.com")).toBe(false);
    expect(isCompanyDomain("docusign.net")).toBe(false);
  });

  it("rejects nonsense", () => {
    expect(isCompanyDomain(null)).toBe(false);
    expect(isCompanyDomain("localhost")).toBe(false);
  });
});
