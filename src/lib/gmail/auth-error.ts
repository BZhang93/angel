// Google's token endpoint speaks in codes. A failure that reaches the screen
// should say what the reader can do about it instead, and the two codes mean
// opposite things: one is fixed by reconnecting, the other cannot be fixed by
// the reader at all. Pure so it can be tested without a Gmail client.

const RECONNECT =
  "Gmail access has expired or been revoked. Reconnect Gmail in Settings to restore it. Nothing already imported is affected.";

const MISCONFIGURED =
  "Google rejected this app's credentials, so reconnecting will not help. GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET need checking.";

/// Readable copy for a Google OAuth failure, or null when the error is
/// something else and its own message should stand.
export function gmailAuthMessage(message: string): string | null {
  if (message.includes("invalid_client") || message.includes("unauthorized_client")) {
    return MISCONFIGURED;
  }
  if (message.includes("invalid_grant") || message.includes("token refresh failed")) {
    return RECONNECT;
  }
  return null;
}

/// The message to show for any thrown value from a Gmail code path.
export function syncErrorMessage(error: unknown, fallback = "Sync failed."): string {
  if (!(error instanceof Error)) return fallback;
  return gmailAuthMessage(error.message) ?? error.message;
}
