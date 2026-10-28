import { describe, expect, it } from "vitest";
import { aiAuthMessage, extractionErrorMessage } from "./errors";

describe("aiAuthMessage", () => {
  it("names the terminal command for an expired local login", () => {
    // The SDK's real wording, path and all. This is the failure that silently
    // stopped every extraction, and the message has to say what fixes it.
    const message = aiAuthMessage(
      "Access token at /Users/someone/.config/anthropic/credentials/default.json has expired and no refresh is available (client_id set, refresh_token empty)",
    );
    expect(message).toContain("ant auth login");
    expect(message).toContain("ANTHROPIC_API_KEY");
  });

  it("promises the retry, because the assignment stands either way", () => {
    const message = aiAuthMessage("Access token has expired and no refresh is available");
    expect(message).toContain("next sync re-reads");
  });

  it("does not offer a terminal command to a deployment with no key", () => {
    expect(aiAuthMessage("Claude is not configured. Set ANTHROPIC_API_KEY")).toContain(
      "Set ANTHROPIC_API_KEY",
    );
  });

  it("separates waiting from fixing", () => {
    expect(aiAuthMessage("429 rate_limit_error")).toContain("rate limiting");
    expect(aiAuthMessage("529 overloaded_error")).toContain("unavailable");
  });

  it("leaves a schema failure alone", () => {
    expect(aiAuthMessage("Response failed to parse against the schema at metrics[0].value")).toBeNull();
  });
});

describe("extractionErrorMessage", () => {
  it("rewrites an auth failure and passes everything else through", () => {
    expect(
      extractionErrorMessage(new Error("Access token has expired and no refresh is available")),
    ).toContain("ant auth login");
    expect(extractionErrorMessage(new Error("Model declined to answer."))).toBe(
      "Model declined to answer.",
    );
  });

  it("falls back for a thrown non-error", () => {
    expect(extractionErrorMessage({})).toBe("Extraction failed.");
  });
});

describe("aiAuthMessage, what it must not claim", () => {
  it("leaves another service's failure to that service", () => {
    // These reached extractionErrorMessage through shared call paths and were
    // being rewritten into "set ANTHROPIC_API_KEY", which is the wrong fix
    // stated confidently.
    expect(aiAuthMessage("No Pub/Sub topic configured; polling instead.")).toBeNull();
    expect(
      aiAuthMessage("Google token refresh failed (401): invalid_client: Unauthorized"),
    ).toBeNull();
    expect(aiAuthMessage("Gmail /profile failed (401): bad credentials")).toBeNull();
  });
});
