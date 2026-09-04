import "server-only";

// DocuSign eSignature REST access.
//
// Authorization Code grant with a refresh token, the same shape as Gmail. Two
// details that break this integration if missed:
//   - the API host is per account, returned by userinfo. Hardcoding the regional
//     host works until an account lives somewhere else.
//   - demo and production are separate worlds with separate hosts, and an
//     integration key must be promoted before it works against production.

const ENVIRONMENT = process.env.DOCUSIGN_ENV === "production" ? "production" : "demo";

const AUTH_HOST =
  ENVIRONMENT === "production" ? "https://account.docusign.com" : "https://account-d.docusign.com";

/// Read-only in practice: `signature` is required to call the eSignature API at
/// all, and `extended` is what makes a refresh token last.
export const DOCUSIGN_SCOPES = "signature extended";

export function docusignConfigured(): boolean {
  return !!process.env.DOCUSIGN_INTEGRATION_KEY && !!process.env.DOCUSIGN_SECRET_KEY;
}

function credentials() {
  const clientId = process.env.DOCUSIGN_INTEGRATION_KEY;
  const clientSecret = process.env.DOCUSIGN_SECRET_KEY;
  if (!clientId || !clientSecret) {
    throw new Error(
      "DocuSign is not configured (DOCUSIGN_INTEGRATION_KEY / DOCUSIGN_SECRET_KEY).",
    );
  }
  return { clientId, clientSecret };
}

export function authorizeUrl(redirectUri: string, state: string): string {
  const { clientId } = credentials();
  const params = new URLSearchParams({
    response_type: "code",
    scope: DOCUSIGN_SCOPES,
    client_id: clientId,
    redirect_uri: redirectUri,
    state,
  });
  return `${AUTH_HOST}/oauth/auth?${params}`;
}

function basicAuth(): string {
  const { clientId, clientSecret } = credentials();
  return Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
}

async function token(body: URLSearchParams): Promise<{ access_token: string; refresh_token?: string }> {
  const response = await fetch(`${AUTH_HOST}/oauth/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basicAuth()}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });

  const data = (await response.json()) as {
    access_token?: string;
    refresh_token?: string;
    error_description?: string;
    error?: string;
  };
  if (!response.ok || !data.access_token) {
    throw new Error(
      `DocuSign token request failed: ${data.error_description ?? data.error ?? response.status}`,
    );
  }
  return { access_token: data.access_token, refresh_token: data.refresh_token };
}

export async function exchangeCode(code: string, redirectUri: string) {
  const result = await token(
    new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirectUri }),
  );
  if (!result.refresh_token) {
    throw new Error("DocuSign returned no refresh token. Check that the `extended` scope was granted.");
  }
  return { accessToken: result.access_token, refreshToken: result.refresh_token };
}

export async function accessTokenFromRefresh(refreshToken: string): Promise<string> {
  const result = await token(
    new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken }),
  );
  return result.access_token;
}

export interface DocusignIdentity {
  accountId: string;
  accountName: string;
  baseUri: string;
}

/// The default account and, crucially, its API base URI.
export async function getIdentity(accessToken: string): Promise<DocusignIdentity> {
  const response = await fetch(`${AUTH_HOST}/oauth/userinfo`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) throw new Error(`DocuSign userinfo failed (${response.status}).`);

  const data = (await response.json()) as {
    accounts?: { account_id: string; account_name: string; base_uri: string; is_default: boolean }[];
  };
  const account = data.accounts?.find((entry) => entry.is_default) ?? data.accounts?.[0];
  if (!account) throw new Error("DocuSign returned no accounts for this login.");

  return {
    accountId: account.account_id,
    accountName: account.account_name,
    baseUri: account.base_uri,
  };
}

async function apiGet<T>(
  accessToken: string,
  identity: { baseUri: string; accountId: string },
  path: string,
): Promise<T> {
  const response = await fetch(
    `${identity.baseUri}/restapi/v2.1/accounts/${identity.accountId}${path}`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!response.ok) {
    throw new Error(`DocuSign ${path} failed (${response.status}): ${await response.text()}`);
  }
  return (await response.json()) as T;
}

export interface DocusignEnvelope {
  envelopeId: string;
  emailSubject: string;
  status: string;
  completedDateTime?: string;
  sentDateTime?: string;
  recipients?: { signers?: { name?: string; email?: string }[] };
}

/// Completed envelopes only. A draft or voided envelope states terms that were
/// never agreed, and must not be allowed near a position.
export async function listCompletedEnvelopes(
  accessToken: string,
  identity: { baseUri: string; accountId: string },
  opts: { fromDate: Date },
): Promise<DocusignEnvelope[]> {
  const params = new URLSearchParams({
    from_date: opts.fromDate.toISOString(),
    status: "completed",
    include: "recipients",
    order_by: "completed",
    count: "100",
  });

  const data = await apiGet<{ envelopes?: DocusignEnvelope[] }>(
    accessToken,
    identity,
    `/envelopes?${params}`,
  );
  return data.envelopes ?? [];
}

/// The combined PDF of every document in an envelope, which is what the terms
/// extractor wants: one file holding the instrument and its exhibits.
export async function downloadEnvelopePdf(
  accessToken: string,
  identity: { baseUri: string; accountId: string },
  envelopeId: string,
): Promise<Buffer> {
  const response = await fetch(
    `${identity.baseUri}/restapi/v2.1/accounts/${identity.accountId}/envelopes/${envelopeId}/documents/combined`,
    { headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/pdf" } },
  );
  if (!response.ok) {
    throw new Error(`DocuSign document download failed (${response.status}).`);
  }
  return Buffer.from(await response.arrayBuffer());
}
