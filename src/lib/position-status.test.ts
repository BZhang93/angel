import { describe, expect, it } from "vitest";
import { OUTCOMES, isClosed, outcomeFor, sharedOutcome, statusLabel } from "./position-status";

describe("outcomes", () => {
  it("writes a ledger line for every outcome that moved money", () => {
    for (const outcome of OUTCOMES) {
      if (outcome.expectsProceeds) expect(outcome.ledgerKind).not.toBeNull();
    }
  });

  it("knows a cancelled commitment moved nothing", () => {
    expect(outcomeFor("CANCELLED")?.ledgerKind).toBeNull();
  });

  it("treats a write-off as dated but not a proceeds event", () => {
    const written = outcomeFor("WRITTEN_OFF")!;
    expect(written.ledgerKind).toBe("WRITE_OFF");
    expect(written.expectsProceeds).toBe(false);
  });
});

describe("isClosed", () => {
  it("is false only for an active position", () => {
    expect(isClosed("ACTIVE")).toBe(false);
    for (const outcome of OUTCOMES) expect(isClosed(outcome.status)).toBe(true);
  });

  it("does not close on a status it does not know", () => {
    expect(isClosed("SOMETHING_ELSE")).toBe(false);
  });
});

describe("sharedOutcome", () => {
  it("names the outcome when every position ended the same way", () => {
    expect(sharedOutcome(["REFUNDED"])).toBe("Refunded");
    expect(sharedOutcome(["EXITED", "EXITED"])).toBe("Exited");
  });

  // A written-off first cheque beside a live follow-on is still a live holding.
  it("stays open while any position is active", () => {
    expect(sharedOutcome(["WRITTEN_OFF", "ACTIVE"])).toBeNull();
  });

  it("does not flatten two different endings into one of them", () => {
    expect(sharedOutcome(["EXITED", "SECONDARY_SOLD"])).toBe("Closed");
  });

  it("says nothing about a company with no positions", () => {
    expect(sharedOutcome([])).toBeNull();
  });

  it("labels an unknown status as active rather than inventing one", () => {
    expect(statusLabel("WHATEVER")).toBe("Active");
  });
});
