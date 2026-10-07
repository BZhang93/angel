import { describe, expect, it } from "vitest";
import { gmailAuthMessage, syncErrorMessage } from "./auth-error";

describe("gmailAuthMessage", () => {
  it("tells the reader to reconnect when the grant is dead", () => {
    const message = gmailAuthMessage("Google token refresh failed (400): invalid_grant: Bad Request");
    expect(message).toContain("Reconnect Gmail in Settings");
    // The copy has to promise this: a reader who has 196 imported updates
    // will not click a button that might drop them.
    expect(message).toContain("Nothing already imported is affected");
  });

  it("does not offer reconnecting when the credentials are the problem", () => {
    const message = gmailAuthMessage("Google token refresh failed (401): invalid_client: Unauthorized");
    expect(message).toContain("reconnecting will not help");
    expect(message).not.toContain("Reconnect Gmail in Settings");
  });

  it("leaves unrelated failures alone", () => {
    expect(gmailAuthMessage("Gmail /profile failed (500): backend error")).toBeNull();
  });

  it("recognises a refresh failure even without a code", () => {
    expect(gmailAuthMessage("Google token refresh failed (400): no error body")).toContain(
      "Reconnect",
    );
  });
});

describe("syncErrorMessage", () => {
  it("rewrites an auth failure and passes everything else through", () => {
    expect(syncErrorMessage(new Error("invalid_grant: Bad Request"))).toContain("Reconnect");
    expect(syncErrorMessage(new Error("A Gmail query is required."))).toBe(
      "A Gmail query is required.",
    );
  });

  it("falls back for a thrown non-error", () => {
    expect(syncErrorMessage("boom")).toBe("Sync failed.");
  });
});
