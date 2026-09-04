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

/// Whole-word, case-insensitive occurrence. Word boundaries matter: "Saile"
/// must not match inside "assailed", and "Bravi" must not match "Bravissimo".
export function mentionsCompany(text: string, name: string): boolean {
  if (!isMatchableName(name)) return false;
  return new RegExp(`\\b${escapeRegExp(name.trim())}\\b`, "i").test(text);
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
  const haystack = `${opts.subject ?? ""}\n${text}`;
  const hits = companies.filter((company) => mentionsCompany(haystack, company.name));
  if (hits.length === 0) return null;

  if (hits.length === 1) {
    const hit = hits[0]!;
    // A name in the subject line is a stronger claim than one buried in a
    // paragraph, which might be an aside.
    const inSubject = opts.subject ? mentionsCompany(opts.subject, hit.name) : false;
    return { companyId: hit.companyId, confidence: inSubject ? 0.95 : 0.85, matchedName: hit.name };
  }

  // Several named: only a subject-line mention breaks the tie, and even then
  // not confidently enough to file without review.
  const inSubject = hits.filter((hit) => opts.subject && mentionsCompany(opts.subject, hit.name));
  if (inSubject.length === 1) {
    const hit = inSubject[0]!;
    return { companyId: hit.companyId, confidence: 0.7, matchedName: hit.name };
  }
  return null;
}
