// Deciding when two names are the same company.
//
// The same business arrives more than once: directly and through a syndicate,
// or as "Bravi" one month and "Bravi Inc." the next. Exact-name matching alone
// leaves the portfolio quietly double counted, so names are normalised and a
// website domain is treated as stronger evidence than a name.

const LEGAL_SUFFIXES = [
  "inc",
  "inc.",
  "incorporated",
  "llc",
  "l.l.c.",
  "ltd",
  "ltd.",
  "limited",
  "corp",
  "corp.",
  "corporation",
  "co",
  "co.",
  "company",
  "plc",
  "gmbh",
  "sarl",
  "sas",
  "bv",
  "ab",
  "oy",
  "pte",
  "pty",
  "ug",
  "kk",
];

/// Lowercase, strip punctuation and legal suffixes, collapse whitespace.
/// "Bravi, Inc." and "bravi" both become "bravi".
export function normalizeCompanyName(name: string): string {
  const cleaned = name
    .toLowerCase()
    .replace(/[.,]/g, " ")
    .replace(/[^a-z0-9&\s-]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  const words = cleaned.split(" ").filter(Boolean);
  while (words.length > 1 && LEGAL_SUFFIXES.includes(words[words.length - 1]!)) {
    words.pop();
  }
  return words.join(" ");
}

export function domainOfWebsite(website: string | null | undefined): string | null {
  if (!website) return null;
  const host = website
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .split("/")[0]!
    .trim()
    .toLowerCase();
  return host || null;
}

import { isCompanyDomain } from "./domains";

export interface ExistingCompany {
  id: string;
  name: string;
  website: string | null;
}

export type MatchReason = "domain" | "name";

/// Finds the company an incoming proposal should join, if any.
///
/// Domain first: two records sharing a website are the same business whatever
/// they are called. Then the normalised name. Anything looser is left alone,
/// because a wrong merge is far more expensive to undo than a duplicate.
export function findExistingCompany(
  incoming: { name: string; website?: string | null },
  existing: ExistingCompany[],
): { company: ExistingCompany; reason: MatchReason } | null {
  // A syndicate's or a bank's domain is not a website. Treating one as identity
  // would merge every company that sender ever wrote about into a single entry.
  const rawDomain = domainOfWebsite(incoming.website);
  const incomingDomain = isCompanyDomain(rawDomain) ? rawDomain : null;
  if (incomingDomain) {
    const byDomain = existing.find((company) => {
      const domain = domainOfWebsite(company.website);
      return isCompanyDomain(domain) && domain === incomingDomain;
    });
    if (byDomain) return { company: byDomain, reason: "domain" };
  }

  const incomingName = normalizeCompanyName(incoming.name);
  if (!incomingName) return null;

  const byName = existing.find((company) => normalizeCompanyName(company.name) === incomingName);
  return byName ? { company: byName, reason: "name" } : null;
}
