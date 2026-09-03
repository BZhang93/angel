import { describe, expect, it } from "vitest";
import { backoffMs, isRetryableStatus, parseRetryAfter, throttle } from "./throttle";

const QUOTA_BODY = JSON.stringify({
  error: {
    code: 403,
    message:
      "Quota exceeded for quota metric 'Total Query Cost' and limit 'Units per minute per user'",
    errors: [{ reason: "rateLimitExceeded" }],
  },
});

describe("isRetryableStatus", () => {
  it("retries the 403 Gmail uses for per-minute quota", () => {
    expect(isRetryableStatus(403, QUOTA_BODY)).toBe(true);
  });

  it("does not retry a genuine permission failure", () => {
    expect(isRetryableStatus(403, '{"error":{"message":"Insufficient Permission"}}')).toBe(false);
  });

  it("retries 429 and 5xx, not 401 or 404", () => {
    expect(isRetryableStatus(429, "")).toBe(true);
    expect(isRetryableStatus(503, "")).toBe(true);
    expect(isRetryableStatus(401, "")).toBe(false);
    expect(isRetryableStatus(404, "")).toBe(false);
  });
});

describe("backoffMs", () => {
  it("grows exponentially from a full second and caps", () => {
    expect(backoffMs(0)).toBeGreaterThanOrEqual(1000);
    expect(backoffMs(0)).toBeLessThan(1300);
    expect(backoffMs(3)).toBeGreaterThanOrEqual(8000);
    expect(backoffMs(10)).toBeLessThanOrEqual(32_250);
  });

  it("prefers the server's Retry-After", () => {
    expect(backoffMs(0, { retryAfterSeconds: 12 })).toBe(12_000);
    expect(backoffMs(0, { retryAfterSeconds: 600 })).toBe(60_000);
  });
});

describe("parseRetryAfter", () => {
  it("reads a numeric header and ignores anything else", () => {
    expect(parseRetryAfter("30")).toBe(30);
    expect(parseRetryAfter(null)).toBeNull();
    expect(parseRetryAfter("Wed, 21 Oct 2026 07:28:00 GMT")).toBeNull();
  });
});

describe("throttle", () => {
  it("spaces successive calls out", async () => {
    const started: number[] = [];
    const call = () =>
      throttle(async () => {
        started.push(Date.now());
      });

    await Promise.all([call(), call(), call()]);
    expect(started).toHaveLength(3);
    expect(started[2]! - started[0]!).toBeGreaterThanOrEqual(150);
  });

  it("keeps running after a rejection", async () => {
    await expect(
      throttle(async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    await expect(throttle(async () => "still working")).resolves.toBe("still working");
  });
});
