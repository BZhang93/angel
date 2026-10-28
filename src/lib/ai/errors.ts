// Turning a model-layer failure into something the reader can act on.
//
// Pure, so it tests without a client. The cases are separated because the
// actions are different and getting them confused wastes real time: an expired
// local login is fixed in a terminal, a missing key is fixed in the
// environment, and a rate limit is fixed by waiting.

const EXPIRED_PROFILE =
  "Claude could not authenticate: the local `ant auth login` profile has expired. " +
  "Run `ant auth login` again, or set ANTHROPIC_API_KEY. Nothing was lost, and the " +
  "next sync re-reads this update.";

const NOT_CONFIGURED =
  "Claude is not configured, so nothing can be read. Set ANTHROPIC_API_KEY, or run " +
  "`ant auth login` for local development.";

const RATE_LIMITED =
  "Claude is rate limiting these requests. The update is filed and the next sync re-reads it.";

const OVERLOADED =
  "Claude is unavailable right now. The update is filed and the next sync re-reads it.";

/// Readable copy for a model failure, or null when the error belongs to some
/// other layer and its own message should stand.
export function aiAuthMessage(message: string): string | null {
  // The SDK's own wording when a stored OAuth profile has aged out. Matched on
  // the two halves that carry the meaning rather than the whole sentence, which
  // includes a machine-specific path.
  if (/has expired and no refresh is available/i.test(message)) return EXPIRED_PROFILE;
  if (/expired.*access token/i.test(message)) return EXPIRED_PROFILE;
  // Narrow on purpose. A bare /not configured/ or /401/ also matches "Pub/Sub
  // topic not configured" and a Gmail 401 from a dead refresh token, and this
  // text tells the reader to go and fix their Anthropic key: the wrong fix,
  // confidently stated, for a problem in another service.
  if (/claude is not configured/i.test(message)) return NOT_CONFIGURED;
  if (/authentication_error|invalid x-api-key/i.test(message)) return NOT_CONFIGURED;
  if (/\b429\b|rate_limit/i.test(message)) return RATE_LIMITED;
  if (/\b529\b|overloaded/i.test(message)) return OVERLOADED;
  return null;
}

/// The message to show for any thrown value from an extraction path.
export function extractionErrorMessage(error: unknown, fallback = "Extraction failed."): string {
  if (!(error instanceof Error)) return fallback;
  return aiAuthMessage(error.message) ?? error.message;
}
