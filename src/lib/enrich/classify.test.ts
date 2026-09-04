import { describe, expect, it } from "vitest";
import { classifyLink, fetchableUrl, isTooThin, isWorthFetching } from "./classify";

describe("classifyLink", () => {
  it("recognises recording share links", () => {
    expect(classifyLink("https://fathom.video/share/abc123")).toBe("RECORDING");
    expect(classifyLink("https://app.grain.com/share/recording/xyz")).toBe("RECORDING");
  });

  it("recognises memo and doc hosts", () => {
    expect(classifyLink("https://acme.notion.site/Investment-memo-123")).toBe("MEMO");
    expect(classifyLink("https://docs.google.com/document/d/abc/edit")).toBe("MEMO");
  });

  it("refuses to fetch gated portals and data rooms", () => {
    expect(classifyLink("https://docsend.com/view/abc")).toBe("GATED");
    expect(classifyLink("https://app.carta.com/holdings")).toBe("GATED");
    expect(isWorthFetching(classifyLink("https://docsend.com/view/abc"))).toBe(false);
  });

  it("identifies the company's own site, including subdomains", () => {
    expect(classifyLink("https://acme.com/about", { companyDomain: "acme.com" })).toBe("WEBSITE");
    expect(classifyLink("https://blog.acme.com/post", { companyDomain: "acme.com" })).toBe("WEBSITE");
    expect(classifyLink("https://other.com", { companyDomain: "acme.com" })).toBe("OTHER");
  });

  it("leaves unknown hosts alone", () => {
    expect(isWorthFetching(classifyLink("https://random.example/page"))).toBe(false);
  });
});

describe("isTooThin", () => {
  it("rejects a login wall or a client-rendered shell", () => {
    expect(isTooThin("Sign in to continue")).toBe(true);
    expect(isTooThin("You need to enable JavaScript to run this app.")).toBe(true);
  });

  it("accepts a page with real content", () => {
    expect(isTooThin(Array.from({ length: 200 }, () => "word").join(" "))).toBe(false);
  });
});

describe("fetchableUrl", () => {
  it("rewrites a Google Doc to its text export, which is what a logged-out fetch can read", () => {
    expect(
      fetchableUrl("https://docs.google.com/document/d/1651Hy59uyV1rx/edit?usp=drive_link"),
    ).toBe("https://docs.google.com/document/d/1651Hy59uyV1rx/export?format=txt");
  });

  it("leaves a sheet alone, whose CSV export is thinner than its rendered view", () => {
    const sheet = "https://docs.google.com/spreadsheets/d/1hAK/edit#gid=0";
    expect(fetchableUrl(sheet)).toBe(sheet);
  });

  it("leaves everything else exactly as it was", () => {
    for (const url of [
      "https://www.bravi.app/",
      "https://app.spiky.ai/meetings/public/2b4af228",
      "https://docs.google.com/forms/d/1abc/viewform",
      "not a url",
    ]) {
      expect(fetchableUrl(url)).toBe(url);
    }
  });
});
