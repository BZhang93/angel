import { describe, expect, it } from "vitest";
import { pickProfileSource, sourceFraming } from "./profile-source";

const website = { kind: "WEBSITE", textContent: "what we do", id: "w" };
const memo = { kind: "MEMO", textContent: "the sector is X", id: "m" };
const recording = { kind: "RECORDING", textContent: "so yeah, um", id: "r" };

describe("pickProfileSource", () => {
  it("prefers a website over everything else", () => {
    expect(pickProfileSource([recording, memo, website])?.id).toBe("w");
  });

  it("prefers a memo over a recording", () => {
    expect(pickProfileSource([recording, memo])?.id).toBe("m");
  });

  it("falls back to a recording when it is all there is", () => {
    expect(pickProfileSource([recording])?.id).toBe("r");
  });

  it("ignores a document with no text, which is the case a login wall creates", () => {
    expect(pickProfileSource([{ ...website, textContent: "" }, memo])?.id).toBe("m");
    expect(pickProfileSource([{ ...website, textContent: null }, memo])?.id).toBe("m");
  });

  it("breaks a tie on the order given, which the caller sorts oldest first", () => {
    const first = { kind: "MEMO", textContent: "announcement memo", id: "first" };
    const second = { kind: "MEMO", textContent: "later memo", id: "second" };
    expect(pickProfileSource([first, second])?.id).toBe("first");
  });

  it("returns null when nothing qualifies", () => {
    expect(pickProfileSource([])).toBeNull();
    expect(pickProfileSource([{ kind: "K1", textContent: "tax form", id: "k" }])).toBeNull();
  });
});

describe("sourceFraming", () => {
  it("tells the model a memo is about a deal, so it profiles the company instead", () => {
    expect(sourceFraming("MEMO").caution).toContain("never the deal");
  });

  it("warns that a transcript is speech, so gaps stay null", () => {
    expect(sourceFraming("RECORDING").caution).toContain("prefer null");
  });
});
