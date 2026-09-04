// Deciding which links are worth fetching, and what they are.
//
// Three groups matter, treated differently:
//   - memos and call recordings: the substance. Usually ungated share links,
//     and a recording page carries its transcript.
//   - a company's own site: profile polish, fetched once.
//   - everything else, including gated portals and data rooms: never fetched,
//     because a server-side fetch of a Docsend link stores the words "Sign in".

export type LinkKind = "MEMO" | "RECORDING" | "WEBSITE" | "GATED" | "OTHER";

/// Share links whose pages carry a transcript or recording summary.
const RECORDING_HOSTS = [
  // Viaka runs every deal Q&A through Spiky, so this one host covers the call
  // recording for essentially the whole portfolio.
  "spiky.ai",
  "fathom.video",
  "grain.com",
  "grain.co",
  "fireflies.ai",
  "otter.ai",
  "tldv.io",
  "read.ai",
  "loom.com",
  "riverside.fm",
  "descript.com",
  "vimeo.com",
];

/// Document hosts that serve real text to an unauthenticated reader.
const MEMO_HOSTS = [
  "notion.site",
  "notion.so",
  "docs.google.com",
  "coda.io",
  "substack.com",
  "medium.com",
  "hackmd.io",
  "quip.com",
  "github.io",
];

/// Anything that answers a logged-out fetch with a login wall. Fetching these
/// gains nothing and tells the sender the link was opened.
const GATED_HOSTS = [
  "docsend.com",
  "carta.com",
  "angellist.com",
  "republic.com",
  "wefunder.com",
  "allocations.com",
  "sydecar.io",
  "assure.co",
  "vauban.io",
  "odin.co",
  "pulley.com",
  "ltse.com",
  "hellosign.com",
  "docusign.net",
  "adobesign.com",
  "box.com",
  "drive.google.com",
];

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return null;
  }
}

function matches(host: string, list: string[]): boolean {
  return list.some((entry) => host === entry || host.endsWith(`.${entry}`));
}

export function classifyLink(url: string, opts: { companyDomain?: string | null } = {}): LinkKind {
  const host = hostOf(url);
  if (!host) return "OTHER";

  if (matches(host, GATED_HOSTS)) return "GATED";
  if (matches(host, RECORDING_HOSTS)) return "RECORDING";
  if (matches(host, MEMO_HOSTS)) return "MEMO";

  const companyDomain = opts.companyDomain?.replace(/^www\./i, "").toLowerCase();
  if (companyDomain && (host === companyDomain || host.endsWith(`.${companyDomain}`))) {
    return "WEBSITE";
  }

  return "OTHER";
}

/// A type predicate, so a caller that has checked this can use the kind
/// directly without re-proving it is fetchable.
export type FetchableKind = Extract<LinkKind, "MEMO" | "RECORDING" | "WEBSITE">;

export function isWorthFetching(kind: LinkKind): kind is FetchableKind {
  return kind === "MEMO" || kind === "RECORDING" || kind === "WEBSITE";
}

/// Text short enough to be a login wall, a cookie banner or a client-rendered
/// shell. Storing it would be worse than storing nothing, because it reads as
/// though the page was captured.
export function isTooThin(text: string): boolean {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  if (words < 120) return true;
  return /sign in to continue|please log in|enable javascript to/i.test(text.slice(0, 600));
}

/// The URL to actually fetch for a link, which is not always the link itself.
///
/// Google serves a logged-out fetch of a /document/d/ link an empty app shell,
/// so a memo shared with the whole syndicate reads as about 26 words of chrome
/// and is discarded as too thin. The export endpoint returns the text itself
/// for anything shared "anyone with the link", which is how these are shared.
/// Across this mailbox that is the difference between 26 words and 3,000, on
/// five of the seven companies.
///
/// Documents only, deliberately. A sheet's CSV export is thinner than its HTML
/// view rather than richer, and no deck has ever been linked, so neither earns
/// a code path.
///
/// A rewritten URL is used only for fetching: the original is what gets stored,
/// so provenance still points at the link the email actually contained.
export function fetchableUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }

  if (parsed.hostname.replace(/^www\./i, "").toLowerCase() !== "docs.google.com") return url;

  const match = /^\/document\/d\/([^/]+)/.exec(parsed.pathname);
  return match ? `https://docs.google.com/document/d/${match[1]}/export?format=txt` : url;
}
