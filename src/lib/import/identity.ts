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

/// Words that describe a vehicle rather than the business it holds. A
/// subscription document is issued by "Viaka Asendia AI 2026, LLC"; the company
/// is Asendia.
const VEHICLE_WORDS = new Set(["spv", "fund", "series", "holdings", "vehicle", "syndicate"]);

/// Descriptive tails a company is routinely written without: "Asendia AI" and
/// "Asendia" are one company, as are "Zaqa AI" and "Zaqa".
const DROPPABLE_TAIL = new Set([
  "ai",
  "io",
  "app",
  "technologies",
  "tech",
  "software",
  "systems",
  "group",
]);

/// A stable key for "the same company, written differently".
///
/// This is what stops one business becoming four entries. It strips case,
/// punctuation, legal suffixes, four-digit years, vehicle words, and a
/// descriptive tail, then removes a leading syndicate name when one is known.
/// Deterministic on purpose: fuzzy matching belongs in a suggestion, never in
/// something that silently merges money.
export function canonicalCompanyKey(name: string, opts: { vehicle?: string | null } = {}): string {
  let words = normalizeCompanyName(name).split(" ").filter(Boolean);

  // "Viaka Asendia AI 2026" -> drop the manager's name from the front.
  const vehicle = opts.vehicle ? normalizeCompanyName(opts.vehicle).split(" ") : [];
  while (vehicle.length > 0 && words.length > vehicle.length && words[0] === vehicle[0]) {
    words = words.slice(1);
    vehicle.shift();
  }

  const trimmed = words.filter(
    (word) => !/^(19|20)\d{2}$/.test(word) && !VEHICLE_WORDS.has(word),
  );
  // A company genuinely called "Fund" keeps its name: stripping a word is only
  // safe while something is left to identify it by.
  if (trimmed.length > 0) words = trimmed;

  while (words.length > 1 && DROPPABLE_TAIL.has(words[words.length - 1]!)) {
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
  incoming: { name: string; website?: string | null; vehicle?: string | null },
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

  // Canonical rather than merely normalised: "Asendia" and "Asendia AI" are the
  // same company, and treating them as two is most of how duplicates happen.
  const incomingName = canonicalCompanyKey(incoming.name, { vehicle: incoming.vehicle });
  if (!incomingName) return null;

  const byName = existing.find(
    (company) => canonicalCompanyKey(company.name) === incomingName,
  );
  return byName ? { company: byName, reason: "name" } : null;
}
