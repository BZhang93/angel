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
  attachments: EmailAttachment[];
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
    attachments: listAttachments(message.payload),
  };
}
