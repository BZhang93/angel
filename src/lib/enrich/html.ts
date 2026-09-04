// Turning a fetched page into readable text. Pure, so the parts that decide
// what survives are testable.

/// Elements whose contents are never page text.
const DROP_ELEMENTS = ["script", "style", "noscript", "svg", "head", "nav", "footer", "form"];

export function htmlToText(html: string, opts: { maxChars?: number } = {}): string {
  const maxChars = opts.maxChars ?? 60_000;

  let text = html;
  for (const element of DROP_ELEMENTS) {
    text = text.replace(new RegExp(`<${element}[\\s\\S]*?</${element}>`, "gi"), " ");
  }

  text = text
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h[1-6]|section|article)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/[ \t]{2,}/g, " ")
    // Tags become spaces, which would otherwise leave every line indented.
    .replace(/[ \t]*\n[ \t]*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return text.length > maxChars ? `${text.slice(0, maxChars)}\n…[truncated]` : text;
}

export function pageTitle(html: string): string | null {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!match) return null;
  const title = htmlToText(match[1]!).trim();
  return title || null;
}
