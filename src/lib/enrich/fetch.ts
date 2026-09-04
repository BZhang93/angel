import "server-only";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { htmlToText, pageTitle } from "./html";
import { isInternalHostname, isPrivateAddress } from "./net-guard";

// Fetching a page linked from an email.
//
// Email links are attacker-influenced by definition, so this is deliberately
// paranoid: https and http only, no redirects to private address space, a hard
// size cap, a short timeout, and no credentials or cookies ever. A fetch is
// also observable by whoever sent the link, which is why only classified,
// worth-reading links reach this code.

const TIMEOUT_MS = 12_000;
const MAX_BYTES = 3 * 1024 * 1024;
const MAX_REDIRECTS = 3;

const USER_AGENT = "AngelPortfolio/1.0 (personal investment tracker; link enrichment)";

export class UnsafeUrlError extends Error {}

async function assertPublicUrl(url: URL): Promise<void> {
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new UnsafeUrlError(`Refusing to fetch ${url.protocol} link.`);
  }
  const host = url.hostname;
  if (isIP(host) && isPrivateAddress(host)) {
    throw new UnsafeUrlError("Refusing to fetch a private address.");
  }
  if (isInternalHostname(host)) {
    throw new UnsafeUrlError("Refusing to fetch an internal hostname.");
  }

  const resolved = await lookup(host, { all: true }).catch(() => []);
  if (resolved.length === 0) throw new UnsafeUrlError("Hostname does not resolve.");
  if (resolved.some((entry) => isPrivateAddress(entry.address))) {
    throw new UnsafeUrlError("Hostname resolves to a private address.");
  }
}

export interface FetchedPage {
  finalUrl: string;
  title: string | null;
  text: string;
}

/// Fetches a page and returns its readable text. Redirects are followed by hand
/// so each hop gets the same safety check as the first.
export async function fetchPage(rawUrl: string): Promise<FetchedPage> {
  let url = new URL(rawUrl);

  for (let redirect = 0; ; redirect++) {
    await assertPublicUrl(url);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(url, {
        redirect: "manual",
        signal: controller.signal,
        headers: { "User-Agent": USER_AGENT, Accept: "text/html,text/plain;q=0.9" },
      });
    } finally {
      clearTimeout(timer);
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location || redirect >= MAX_REDIRECTS) {
        throw new Error(`Too many redirects fetching ${rawUrl}.`);
      }
      url = new URL(location, url);
      continue;
    }

    if (!response.ok) throw new Error(`Fetch failed (${response.status}) for ${url.href}.`);

    const contentType = response.headers.get("content-type") ?? "";
    if (!/text\/html|text\/plain|application\/xhtml/i.test(contentType)) {
      throw new Error(`Unsupported content type "${contentType}" for ${url.href}.`);
    }

    const declaredLength = Number(response.headers.get("content-length") ?? 0);
    if (declaredLength > MAX_BYTES) throw new Error(`Page too large for ${url.href}.`);

    const body = await response.text();
    const html = body.length > MAX_BYTES ? body.slice(0, MAX_BYTES) : body;

    return { finalUrl: url.href, title: pageTitle(html), text: htmlToText(html) };
  }
}
