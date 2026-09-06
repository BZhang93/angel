// Matching an inbound email to a portfolio company. Deterministic first: a
// sender domain that equals a company's website domain, or an address recorded
// as a founder contact, is a certainty. Everything weaker goes to the review
// queue rather than being guessed at.

export interface MatchCandidate {
  companyId: string;
  name: string;
  website: string | null;
  contactEmails: string[];
}

/// What every matcher agrees on: which company, and how sure.
export interface CompanyMatch {
  companyId: string;
  confidence: number;
}

export interface MatchResult {
  companyId: string;
  confidence: number;
  reason: "contact" | "domain" | "name";
}

/// Anything at or above this is auto-assigned; below it the update waits for a
/// human in the review queue.
export const AUTO_MATCH_THRESHOLD = 0.8;

/// Below the auto-file bar but worth showing: the update stays pending and
/// carries the company as a suggestion, which is what the review queue's
/// confidence pill has always been for and what lets the queue group itself.
/// Under this, a guess is noise and the row is better left blank.
export const SUGGESTION_THRESHOLD = 0.5;

export function domainOf(value: string | null | undefined): string | null {
  if (!value) return null;
  const raw = value.includes("@") ? value.split("@").pop()! : value;
  const host = raw
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .split("/")[0]!
    .trim()
    .toLowerCase();
  return host || null;
}

export function matchCompany(
  email: { fromAddress: string; subject: string | null },
  candidates: MatchCandidate[],
): MatchResult | null {
  const address = email.fromAddress.toLowerCase();
  const senderDomain = domainOf(address);

  for (const candidate of candidates) {
    if (candidate.contactEmails.some((contact) => contact.toLowerCase() === address)) {
      return { companyId: candidate.companyId, confidence: 1, reason: "contact" };
    }
  }

  if (senderDomain) {
    for (const candidate of candidates) {
      if (domainOf(candidate.website) === senderDomain) {
        return { companyId: candidate.companyId, confidence: 0.95, reason: "domain" };
      }
    }
  }

  // Name in the subject line. Weak on purpose: it lands under the threshold and
  // shows up as a suggestion in the review queue.
  const subject = (email.subject ?? "").toLowerCase();
  if (subject) {
    for (const candidate of candidates) {
      const name = candidate.name.toLowerCase();
      if (name.length >= 4 && subject.includes(name)) {
        return { companyId: candidate.companyId, confidence: 0.6, reason: "name" };
      }
    }
  }

  return null;
}

/// The strongest of several readings of the same email, or null if none
/// matched.
///
/// Sender and content answer different questions, and the sender rule is
/// deliberately weak at its lower end: a company name in the subject scores
/// 0.6, under the threshold, so it surfaces as a suggestion in the review queue
/// rather than filing itself. Resolving the two with `sender ?? content` let
/// that 0.6 suppress a 0.95 content match, and the email was then dropped for
/// sitting under the threshold. It filed nothing and reported nothing: 135 of
/// 169 unfiled emails were stuck behind exactly that, including every Viaka
/// deal thread, whose subjects name the company and therefore always hit the
/// weak rule first.
///
/// Deliberately not generic over the two match types: a caller only ever needs
/// which company and how sure, and widening to that lets a sender match and a
/// content match be compared directly.
export function bestMatch(
  ...matches: Array<CompanyMatch | null | undefined>
): CompanyMatch | null {
  let best: CompanyMatch | null = null;
  for (const match of matches) {
    if (!match) continue;
    if (!best || match.confidence > best.confidence) best = match;
  }
  return best;
}
