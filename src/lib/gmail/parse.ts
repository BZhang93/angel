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
  body?: { data?: string; size?: number };
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

/// Drops quoted reply history and trailing signature blocks. Extraction quality
/// falls off sharply when last quarter's numbers are still in the text.
export function stripQuotedReplies(text: string): string {
  let cut = text.length;
  for (const marker of QUOTE_MARKERS) {
    const match = marker.exec(text);
    if (match && match.index < cut) cut = match.index;
  }

  const trimmed = text.slice(0, cut);
  const signature = trimmed.search(/^--\s*$/m);
  return (signature >= 0 ? trimmed.slice(0, signature) : trimmed).trim();
}

export interface ParsedEmail {
  gmailMessageId: string;
  gmailThreadId: string | null;
  receivedAt: Date;
  fromAddress: string;
  fromName: string | null;
  subject: string | null;
  text: string;
}

export function parseMessage(message: GmailMessage): ParsedEmail {
  const from = parseFrom(header(message, "From"));
  const dateHeader = header(message, "Date");
  const received = message.internalDate
    ? new Date(Number(message.internalDate))
    : dateHeader
      ? new Date(dateHeader)
      : new Date();

  return {
    gmailMessageId: message.id,
    gmailThreadId: message.threadId ?? null,
    receivedAt: Number.isNaN(received.getTime()) ? new Date() : received,
    fromAddress: from.address,
    fromName: from.name,
    subject: header(message, "Subject"),
    text: stripQuotedReplies(extractBody(message.payload)),
  };
}
