import "server-only";
import { parseMessage, type GmailMessage, type ParsedEmail } from "./parse";

// Gmail REST access over plain fetch. Read-only scope, no googleapis SDK: the
// three endpoints this app needs are simpler than the dependency.

const OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";

export const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";

export function googleOAuthConfigured(): boolean {
  return !!process.env.GOOGLE_CLIENT_ID && !!process.env.GOOGLE_CLIENT_SECRET;
}

function credentials() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("Gmail is not configured (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET).");
  }
  return { clientId, clientSecret };
}

/// Consent URL. `prompt=consent` with `access_type=offline` is what guarantees a
/// refresh token comes back; without it Google returns one only on first ever
/// authorisation, which makes re-connecting silently useless.
export function authorizeUrl(redirectUri: string, state: string): string {
  const { clientId } = credentials();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: GMAIL_SCOPE,
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

export async function exchangeCode(
  code: string,
  redirectUri: string,
): Promise<{ accessToken: string; refreshToken: string }> {
  const { clientId, clientSecret } = credentials();
  const response = await fetch(OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });

  const data = (await response.json()) as {
    access_token?: string;
    refresh_token?: string;
    error_description?: string;
  };
  if (!response.ok || !data.access_token) {
    throw new Error(`Google token exchange failed: ${data.error_description ?? response.status}`);
  }
  if (!data.refresh_token) {
    throw new Error(
      "Google returned no refresh token. Revoke the app's access in your Google account and connect again.",
    );
  }
  return { accessToken: data.access_token, refreshToken: data.refresh_token };
}

export async function accessTokenFromRefresh(refreshToken: string): Promise<string> {
  const { clientId, clientSecret } = credentials();
  const response = await fetch(OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
    }),
  });

  const data = (await response.json()) as { access_token?: string; error_description?: string };
  if (!response.ok || !data.access_token) {
    throw new Error(`Google token refresh failed: ${data.error_description ?? response.status}`);
  }
  return data.access_token;
}

async function gmailGet<T>(accessToken: string, path: string): Promise<T> {
  const response = await fetch(`${GMAIL_API}${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    throw new Error(`Gmail ${path} failed (${response.status}): ${await response.text()}`);
  }
  return (await response.json()) as T;
}

export async function getProfile(accessToken: string) {
  return gmailGet<{ emailAddress: string; historyId: string }>(accessToken, "/profile");
}

/// Message ids matching the user's sync query. Paged, and deliberately capped:
/// a first sync of a decade-old mailbox should not run for an hour.
export async function listMessageIds(
  accessToken: string,
  query: string,
  opts: { maxMessages?: number } = {},
): Promise<string[]> {
  const maxMessages = opts.maxMessages ?? 200;
  const ids: string[] = [];
  let pageToken: string | undefined;

  do {
    const params = new URLSearchParams({ q: query, maxResults: "100" });
    if (pageToken) params.set("pageToken", pageToken);

    const page = await gmailGet<{
      messages?: { id: string }[];
      nextPageToken?: string;
    }>(accessToken, `/messages?${params}`);

    ids.push(...(page.messages ?? []).map((message) => message.id));
    pageToken = page.nextPageToken;
  } while (pageToken && ids.length < maxMessages);

  return ids.slice(0, maxMessages);
}

export async function getMessage(accessToken: string, id: string): Promise<ParsedEmail> {
  const message = await gmailGet<GmailMessage>(accessToken, `/messages/${id}?format=full`);
  return parseMessage(message);
}
