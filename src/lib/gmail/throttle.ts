// Gmail rate limiting. The API allows 6,000 quota units per minute per user,
// and messages.get costs 5 units, so a tight fetch loop over a few hundred
// messages trips "Quota exceeded ... Units per minute per user" within seconds.
//
// The pure decisions live here so the retry policy is testable without a
// network: what counts as retryable, and how long to wait.

/// Units per minute per user, from the Gmail quota page.
export const QUOTA_UNITS_PER_MINUTE = 6000;
/// messages.get and messages.list both cost 5 units.
export const UNITS_PER_REQUEST = 5;

/// Requests per second that stays comfortably inside the quota. Half the
/// theoretical ceiling, because the ceiling is shared with anything else using
/// the same credentials, and a scan is not latency sensitive.
export const MAX_REQUESTS_PER_SECOND = 10;

export const MIN_REQUEST_INTERVAL_MS = Math.ceil(1000 / MAX_REQUESTS_PER_SECOND);

/// 429 is the documented rate-limit status, but Gmail returns 403 with a
/// rateLimitExceeded reason for per-minute quota, which is the one that bites
/// during a scan. 5xx is worth retrying too; 401/404 is not.
export function isRetryableStatus(status: number, body: string): boolean {
  if (status === 429) return true;
  if (status >= 500) return true;
  if (status === 403) {
    return /rateLimitExceeded|userRateLimitExceeded|RATE_LIMIT_EXCEEDED|Quota exceeded/i.test(body);
  }
  return false;
}

/// Exponential backoff with jitter, capped. A per-minute quota needs seconds of
/// waiting, not milliseconds, so the first retry already waits a full second.
export function backoffMs(attempt: number, opts: { retryAfterSeconds?: number | null } = {}): number {
  if (opts.retryAfterSeconds != null && opts.retryAfterSeconds > 0) {
    return Math.min(opts.retryAfterSeconds * 1000, 60_000);
  }
  const base = Math.min(1000 * 2 ** attempt, 32_000);
  // Jitter avoids a synchronised retry storm when several requests fail at once.
  return base + Math.floor(Math.random() * 250);
}

export function parseRetryAfter(value: string | null): number | null {
  if (!value) return null;
  const seconds = Number(value);
  return Number.isFinite(seconds) ? seconds : null;
}

/// Serialises callers and spaces them by MIN_REQUEST_INTERVAL_MS. A single
/// chained promise rather than a token bucket: requests here are sequential
/// anyway, and this cannot leak timers.
let chain: Promise<void> = Promise.resolve();
let lastStartedAt = 0;

export function throttle<T>(work: () => Promise<T>): Promise<T> {
  const result = chain.then(async () => {
    const wait = Math.max(0, lastStartedAt + MIN_REQUEST_INTERVAL_MS - Date.now());
    if (wait > 0) await sleep(wait);
    lastStartedAt = Date.now();
    return work();
  });

  // Keep the chain alive even when a call rejects, or one failure would wedge
  // every later request.
  chain = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
