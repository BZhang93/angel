// Building Gmail queries for companies already in the portfolio.
//
// Pure and tested, because this is the part that quietly goes wrong: a query
// that is too broad reads unrelated mail, and one that is too long is rejected
// by Gmail outright.

export interface CompanySender {
  companyId: string;
  name: string;
  website: string | null;
  contactEmails: string[];
}

/// Gmail rejects very long queries, and a huge OR chain also slows the search
/// down. Companies are batched so each query stays comfortably short.
export const MAX_SENDERS_PER_QUERY = 20;

export function senderTermsFor(company: CompanySender): string[] {
  const terms = new Set<string>();

  const domain = domainOfWebsite(company.website);
  // A domain term matches every address at that domain, so a contact at the
  // same domain adds nothing.
  if (domain) terms.add(`from:${domain}`);

  for (const email of company.contactEmails) {
    const address = email.trim().toLowerCase();
    if (!address.includes("@")) continue;
    if (domain && address.endsWith(`@${domain}`)) continue;
    terms.add(`from:${address}`);
  }

  return [...terms];
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

/// One query per batch of companies, bounded by age. Companies with no domain
/// and no contact are skipped: there is nothing to search on, and `from:` with
/// an empty term would match the whole mailbox.
export function buildUpdateQueries(
  companies: CompanySender[],
  opts: { sinceDays?: number; batchSize?: number } = {},
): string[] {
  const sinceDays = opts.sinceDays ?? 365;
  const batchSize = opts.batchSize ?? MAX_SENDERS_PER_QUERY;

  const terms = companies.flatMap(senderTermsFor);
  if (terms.length === 0) return [];

  const queries: string[] = [];
  for (let index = 0; index < terms.length; index += batchSize) {
    const batch = terms.slice(index, index + batchSize);
    queries.push(`(${batch.join(" OR ")}) newer_than:${sinceDays}d`);
  }
  return queries;
}
