// Matching an email to a company by what it says, not who sent it.
//
// Third-party senders are the whole reason this exists: DocuSign, a bank, a
// syndicate manager. The mail is unambiguously about one of your companies, but
// the sender domain belongs to none of them, so sender matching gives nothing
// and the update lands in the review queue forever.

export interface NamedCompany {
  companyId: string;
  name: string;
}

/// Words that would match half the portfolio if a company were called them, and
/// single short tokens that appear in ordinary prose.
const TOO_GENERIC = new Set(["inc", "labs", "health", "ai", "app", "the", "and", "group", "capital"]);

export function isMatchableName(name: string): boolean {
  const trimmed = name.trim();
  if (trimmed.length < 4) return false;
  return !TOO_GENERIC.has(trimmed.toLowerCase());
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/// Legal and descriptive tails a company is routinely referred to without.
/// "Asendia AI" is called Asendia; "Marr Labs" is called Marr Labs.
const DROPPABLE_TAIL = new Set([
  "ai",
  "inc",
  "inc.",
  "llc",
  "ltd",
  "ltd.",
  "limited",
  "corp",
  "corp.",
  "co",
  "co.",
  "technologies",
  "tech",
  "io",
  "app",
]);

/// The forms an email might use for a company: its full name, and the same name
/// with a droppable tail removed. Both must survive isMatchableName, so a
/// company called "Health AI" never matches on "Health" alone.
export function matchTokensFor(name: string): string[] {
  const full = name.trim();
  const tokens = new Set<string>();
  if (isMatchableName(full)) tokens.add(full);

  const words = full.split(/\s+/).filter(Boolean);
  while (words.length > 1 && DROPPABLE_TAIL.has(words[words.length - 1]!.toLowerCase())) {
    words.pop();
    const shortened = words.join(" ");
    if (isMatchableName(shortened)) tokens.add(shortened);
  }

  return [...tokens];
}

/// Whole-word, case-insensitive occurrence of any form of the name. Word
/// boundaries matter: "Saile" must not match inside "assailed", and "Bravi"
/// must not match "Bravissimo".
export function mentionsCompany(text: string, name: string): boolean {
  const tokens = matchTokensFor(name);
  if (tokens.length === 0) return false;
  return tokens.some((token) => new RegExp(`\\b${escapeRegExp(token)}\\b`, "i").test(text));
}

export interface ContentMatch {
  companyId: string;
  confidence: number;
  matchedName: string;
}

/// The company named in the email, when exactly one is.
///
/// Exactly one is the point: a DocuSign envelope for Asendia names Asendia, so
/// that is certain enough to file. A syndicate's quarterly note listing five
/// companies names all five, and filing it against one of them would be wrong,
/// so an ambiguous match reports lower confidence and goes to review.
export function matchCompanyByContent(
  text: string,
  companies: NamedCompany[],
  opts: { subject?: string | null } = {},
): ContentMatch | null {
  const subject = opts.subject ?? "";
  const inSubject = companies.filter((company) => mentionsCompany(subject, company.name));
  const inBody = companies.filter((company) => mentionsCompany(text, company.name));

  // A subject naming exactly one company is what the email is about. Bodies
  // name others in passing: a footer, a digest link, "as we did with X". Judging
  // on the body alone left "Viaka x Vessel SPV - August 2026 Update" unfiled
  // because the newsletter footer listed the rest of the portfolio.
  if (inSubject.length === 1) {
    const hit = inSubject[0]!;
    const bodyAgrees = inBody.length === 1 && inBody[0]!.companyId === hit.companyId;
    return {
      companyId: hit.companyId,
      confidence: bodyAgrees ? 0.95 : 0.9,
      matchedName: hit.name,
    };
  }

  // Several named in the subject: a digest about the portfolio, not about one
  // company. Filing it against any of them would be wrong.
  if (inSubject.length > 1) return null;

  if (inBody.length === 1) {
    const hit = inBody[0]!;
    return { companyId: hit.companyId, confidence: 0.85, matchedName: hit.name };
  }

  return null;
}
