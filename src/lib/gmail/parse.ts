// Pure Gmail message parsing. Kept free of network and database access so the
// awkward parts (nested MIME parts, base64url, quoted replies) are unit tested
// against fixtures rather than debugged against a live mailbox.

export interface GmailHeader {
  name: string;
  value: string;
}

export interface GmailPart {
  mimeType?: string;
  filename?: string;
  headers?: GmailHeader[];
  /// An attachment part carries `attachmentId` instead of inline `data`; the
  /// bytes are a separate fetch.
  body?: { data?: string; size?: number; attachmentId?: string };
  parts?: GmailPart[];
}

export interface GmailMessage {
  id: string;
  threadId?: string;
  internalDate?: string;
  payload?: GmailPart;
}

export function decodeBase64Url(data: string): string {
  return Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
}

export function header(message: GmailMessage, name: string): string | null {
  const match = message.payload?.headers?.find(
    (h) => h.name.toLowerCase() === name.toLowerCase(),
  );
  return match?.value ?? null;
}

/// "Jane Founder <jane@acme.com>" into its parts. Gmail is inconsistent about
/// quoting and angle brackets, so this handles a bare address too.
export function parseFrom(value: string | null): { name: string | null; address: string } {
  if (!value) return { name: null, address: "" };
  const match = value.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  if (match) {
    return { name: match[1]!.trim() || null, address: match[2]!.trim().toLowerCase() };
  }
  return { name: null, address: value.trim().toLowerCase() };
}

/// Depth-first search for the best text representation: text/plain wins, and
/// HTML is only used (stripped) when there is no plain part.
export function extractBody(part: GmailPart | undefined): string {
  if (!part) return "";

  const plain = findPart(part, "text/plain");
  if (plain?.body?.data) return decodeBase64Url(plain.body.data);

  const html = findPart(part, "text/html");
  if (html?.body?.data) return stripHtml(decodeBase64Url(html.body.data));

  if (part.body?.data) return decodeBase64Url(part.body.data);
  return "";
}

function findPart(part: GmailPart, mimeType: string): GmailPart | null {
  if (part.mimeType === mimeType && part.body?.data) return part;
  for (const child of part.parts ?? []) {
    const found = findPart(child, mimeType);
    if (found) return found;
  }
  return null;
}

export function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const QUOTE_MARKERS = [
  /^On .+ wrote:$/m,
  /^-{2,}\s*Original Message\s*-{2,}$/im,
  /^_{10,}$/m,
  /^From: .+$/m,
];

/// A forward opens with this line and then a header block. The `From:` in that
/// block looks exactly like the top of Outlook reply history, so without this
/// the quote markers below cut at character 39 and discard the entire payload.
/// Investors forward syndicate mail constantly, so the forwarded message is
/// usually the whole point of the email.
const FORWARD_DELIMITER = /^\s*-{3,}\s*Forwarded message\s*-{3,}\s*$/im;
const FORWARD_HEADER = /^(?:from|to|cc|bcc|date|sent|subject|reply-to):/i;

/// Advances past a forward's header block so stripping resumes at the content.
/// Loops because a forwarded forward nests the blocks, and stops as soon as the
/// text no longer opens with one, which leaves genuine reply history to be cut
/// by the markers as before.
function skipForwardHeaders(text: string): string {
  let rest = text;

  for (;;) {
    const match = FORWARD_DELIMITER.exec(rest);
    // Only a delimiter at the top is this email's own forward. One further down
    // belongs to quoted history and is left for the markers.
    if (!match || rest.slice(0, match.index).trim() !== "") return rest;

    const lines = rest.slice(match.index + match[0].length).split("\n");
    let i = 0;
    let sawHeader = false;

    while (i < lines.length) {
      const line = lines[i]!;
      const blank = line.trim() === "";
      // A long recipient list wraps onto an indented line; that continuation is
      // only a header while we are still inside the block.
      const continuation = sawHeader && /^\s+\S/.test(line);
      if (FORWARD_HEADER.test(line.trim())) sawHeader = true;
      else if (!blank && !continuation) break;
      i += 1;
    }

    // No header block means this was not a forward preamble after all.
    if (!sawHeader) return rest;
    rest = lines.slice(i).join("\n");
  }
}

/// Drops quoted reply history and trailing signature blocks. Extraction quality
/// falls off sharply when last quarter's numbers are still in the text.
export function stripQuotedReplies(text: string): string {
  const forwarded = skipForwardHeaders(text);

  let cut = forwarded.length;
  for (const marker of QUOTE_MARKERS) {
    const match = marker.exec(forwarded);
    if (match && match.index < cut) cut = match.index;
  }

  const trimmed = forwarded.slice(0, cut);
  const signature = trimmed.search(/^--\s*$/m);
  return (signature >= 0 ? trimmed.slice(0, signature) : trimmed).trim();
}

/// A body long enough that losing almost all of it means the stripper cut too
/// much, not that the sender was terse. Five months of Saile updates were
/// stored as the 38-character forward delimiter and nothing flagged it, because
/// a short string is a perfectly valid body. Comparing against the pre-strip
/// length is what separates our mistake from a one-line reply.
const TRUNCATION_MIN_RAW = 1000;
const TRUNCATION_KEPT_RATIO = 0.1;

export function looksTruncated(text: string, rawLength: number): boolean {
  if (rawLength < TRUNCATION_MIN_RAW) return false;
  return text.length < rawLength * TRUNCATION_KEPT_RATIO;
}

// Hosts whose links carry no information about an investment: click trackers,
// unsubscribe endpoints, social buttons and image CDNs. Kept out so the useful
// links (the company's site, a data room, a cap table) are not buried.
const NOISE_LINK_HOSTS = [
  "unsubscribe",
  "list-manage.com",
  "mailchimp.com",
  "sendgrid.net",
  "sendgrid.com",
  "mailgun.org",
  "hubspotlinks.com",
  "click.",
  "track.",
  "email.",
  "beacon",
  "doubleclick.net",
  "google-analytics.com",
  "googletagmanager.com",
  "facebook.com",
  "twitter.com",
  "x.com",
  "instagram.com",
  "youtube.com",
  "calendly.com",
  "zoom.us",
  "meet.google.com",
];

function isNoiseLink(url: string): boolean {
  const lower = url.toLowerCase();
  if (/\/unsubscribe|\?unsubscribe|opt[-_]?out/.test(lower)) return true;
  return NOISE_LINK_HOSTS.some((host) => lower.includes(host));
}

/// Links found in an email, deduplicated and stripped of tracking parameters.
///
/// Worth keeping because the useful ones point at things the email only alludes
/// to: the company's own site, a data room, a cap table, a deal page. The HTML
/// body is where they live; stripHtml discards hrefs by design, so they are
/// pulled out before it runs.
export function extractLinks(html: string, opts: { max?: number } = {}): string[] {
  const max = opts.max ?? 25;
  const found = new Map<string, string>();

  const push = (raw: string) => {
    let url: URL;
    try {
      url = new URL(raw.trim().replace(/[),.;'"]+$/, ""));
    } catch {
      return;
    }
    // http(s) only: mailto:, tel: and data: are not pages, and refusing them
    // keeps anything that later fetches a link on safe ground.
    if (url.protocol !== "http:" && url.protocol !== "https:") return;
    if (isNoiseLink(url.href)) return;

    for (const param of [...url.searchParams.keys()]) {
      if (/^(utm_|mc_|ref|source|trk|gclid|fbclid|_hs)/i.test(param)) url.searchParams.delete(param);
    }
    // Key on the normalised form so the same link with different tracking
    // parameters is stored once.
    const key = `${url.host}${url.pathname}`.replace(/\/$/, "").toLowerCase();
    if (!found.has(key)) found.set(key, url.href);
  };

  for (const match of html.matchAll(/href\s*=\s*["']([^"']+)["']/gi)) push(match[1]!);
  // Bare URLs, for plain-text emails that have no markup at all.
  for (const match of html.matchAll(/https?:\/\/[^\s<>"')]+/gi)) push(match[0]);

  return [...found.values()].slice(0, max);
}

export interface EmailAttachment {
  /// Gmail's handle for fetching the bytes, valid for this message only.
  attachmentId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
}

/// Attachment parts anywhere in the MIME tree. Inline images (a logo in a
/// signature) carry a Content-ID and no useful filename, so they are dropped:
/// the point is signed documents, not decoration.
export function listAttachments(part: GmailPart | undefined): EmailAttachment[] {
  if (!part) return [];
  const found: EmailAttachment[] = [];

  const walk = (node: GmailPart) => {
    const filename = node.filename?.trim();
    const attachmentId = node.body?.attachmentId;

    if (filename && attachmentId) {
      const isInline = node.headers?.some(
        (h) =>
          h.name.toLowerCase() === "content-disposition" && /^inline/i.test(h.value.trim()),
      );
      if (!isInline) {
        found.push({
          attachmentId,
          filename,
          mimeType: node.mimeType ?? "application/octet-stream",
          sizeBytes: node.body?.size ?? 0,
        });
      }
    }

    for (const child of node.parts ?? []) walk(child);
  };

  walk(part);
  return found;
}

/// Which attachments are worth storing and reading. A fundraising deck is
/// thirty slides of noise with no binding terms; a signed SAFE is the terms.
const READABLE_MIME_TYPES = ["application/pdf"];

export function isWorthReading(
  attachment: EmailAttachment,
  opts: { maxBytes?: number } = {},
): boolean {
  const maxBytes = opts.maxBytes ?? 20 * 1024 * 1024;
  if (attachment.sizeBytes > maxBytes) return false;
  if (READABLE_MIME_TYPES.includes(attachment.mimeType)) return true;
  return /\.pdf$/i.test(attachment.filename);
}

/// Best guess at what a document is, from its filename. Only ever a default:
/// the reviewer can change it, and the extractor confirms it from the contents.
export function guessDocumentKind(filename: string): string {
  const name = filename.toLowerCase();
  if (/side[\s_-]?letter/.test(name)) return "SIDE_LETTER";
  if (/\bsafe\b|simple agreement/.test(name)) return "SAFE";
  if (/promissory|convertible|\bnote\b/.test(name)) return "NOTE";
  if (/cap[\s_-]?table|capitalization/.test(name)) return "CAP_TABLE";
  if (/k-?1\b/.test(name)) return "K1";
  if (/1099|8949|schedule|tax/.test(name)) return "TAX_OTHER";
  if (/stock|purchase agreement|subscription|series [a-z]\b/.test(name)) return "EQUITY_DOCS";
  return "OTHER";
}

export interface ParsedEmail {
  gmailMessageId: string;
  gmailThreadId: string | null;
  receivedAt: Date;
  fromAddress: string;
  fromName: string | null;
  subject: string | null;
  text: string;
  /// True when stripping removed nearly all of a substantial body, so `text`
  /// cannot be trusted to be what the sender wrote. The sync marks the row
  /// instead of filing it as a healthy update.
  truncated: boolean;
  attachments: EmailAttachment[];
  links: string[];
}

/// The richest body available for link extraction: HTML if there is any, since
/// that is where hrefs live, otherwise the plain text and its bare URLs.
function rawBodyFor(part: GmailPart | undefined): string {
  if (!part) return "";
  const html = findPart(part, "text/html");
  if (html?.body?.data) return decodeBase64Url(html.body.data);
  const plain = findPart(part, "text/plain");
  return plain?.body?.data ? decodeBase64Url(plain.body.data) : "";
}

export function parseMessage(message: GmailMessage): ParsedEmail {
  const from = parseFrom(header(message, "From"));
  const dateHeader = header(message, "Date");
  const received = message.internalDate
    ? new Date(Number(message.internalDate))
    : dateHeader
      ? new Date(dateHeader)
      : new Date();

  const body = extractBody(message.payload);
  const text = stripQuotedReplies(body);

  return {
    gmailMessageId: message.id,
    gmailThreadId: message.threadId ?? null,
    receivedAt: Number.isNaN(received.getTime()) ? new Date() : received,
    fromAddress: from.address,
    fromName: from.name,
    subject: header(message, "Subject"),
    text,
    truncated: looksTruncated(text, body.length),
    attachments: listAttachments(message.payload),
    links: extractLinks(rawBodyFor(message.payload)),
  };
}
