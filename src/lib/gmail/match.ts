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

export interface MatchResult {
  companyId: string;
  confidence: number;
  reason: "contact" | "domain" | "name";
}

/// Anything at or above this is auto-assigned; below it the update waits for a
/// human in the review queue.
export const AUTO_MATCH_THRESHOLD = 0.8;

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
