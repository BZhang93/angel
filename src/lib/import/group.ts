// Turning a pile of emails into candidate companies. Pure and tested: the
// grouping rules are where a mailbox scan quietly goes wrong, by proposing
// "Gmail" and "Substack" as portfolio companies.

import { isGroupableSender } from "./domains";

export interface ScannedEmail {
  gmailMessageId: string;
  gmailThreadId: string | null;
  fromAddress: string;
  fromName: string | null;
  subject: string | null;
  receivedAt: Date;
  text: string;
  /// Filenames only. A countersigned SAFE in the attachment list is evidence of
  /// an investment even when the covering email says nothing.
  attachments: { filename: string }[];
  /// Links found in the body. Often the only place the operating company's own
  /// site appears, which is what deduplication keys off.
  links: string[];
}

export interface DomainGroup {
  domain: string;
  emails: ScannedEmail[];
  /// Best guess at a company name before the model sees anything: the sender's
  /// display name where it looks like a company, else the domain's second-level
  /// label. Gives the reviewer something readable even if extraction fails.
  guessedName: string;
}

export { NON_COMPANY_DOMAINS } from "./domains";

export function domainOfAddress(address: string): string | null {
  const at = address.lastIndexOf("@");
  if (at < 0) return null;
  const domain = address.slice(at + 1).trim().toLowerCase();
  return domain || null;
}

/// Strips the public suffix down to a readable label: "acmerobotics.com" and
/// "mail.acme.co.uk" become "acmerobotics" and "acme".
export function labelFromDomain(domain: string): string {
  const parts = domain.split(".").filter(Boolean);
  const commonSecondLevel = new Set(["co", "com", "org", "net", "ac", "gov"]);

  let index = parts.length - 2;
  if (index > 0 && commonSecondLevel.has(parts[index]!)) index -= 1;
  const label = parts[Math.max(index, 0)] ?? domain;

  return label.charAt(0).toUpperCase() + label.slice(1);
}

/// A display name is only useful as a company name when it does not look like a
/// person. "Acme Robotics" yes; "Jane Founder" no.
export function looksLikeCompanyName(name: string | null): boolean {
  if (!name) return false;
  const trimmed = name.trim();
  if (trimmed.length < 3) return false;
  if (/\b(team|labs?|inc|llc|ltd|technologies|robotics|health|ai|hq)\b/i.test(trimmed)) return true;
  // Two capitalised words with nothing corporate about them reads as a person.
  return !/^[A-Z][a-z]+ [A-Z][a-z]+$/.test(trimmed);
}

export function groupBySenderDomain(
  emails: ScannedEmail[],
  opts: { knownDomains?: Set<string>; minEmails?: number } = {},
): DomainGroup[] {
  const known = opts.knownDomains ?? new Set<string>();
  const minEmails = opts.minEmails ?? 1;
  const groups = new Map<string, ScannedEmail[]>();

  for (const email of emails) {
    const domain = domainOfAddress(email.fromAddress);
    if (!domain) continue;
    // A syndicate's or a bank's domain is not a website, but its mail is
    // exactly where the deals and the transfers are, so it is grouped.
    if (!isGroupableSender(domain)) continue;
    if (known.has(domain)) continue;

    const bucket = groups.get(domain) ?? [];
    bucket.push(email);
    groups.set(domain, bucket);
  }

  return [...groups.entries()]
    .filter(([, bucket]) => bucket.length >= minEmails)
    .map(([domain, bucket]) => {
      const sorted = [...bucket].sort(
        (a, b) => b.receivedAt.getTime() - a.receivedAt.getTime(),
      );
      const named = sorted.find((email) => looksLikeCompanyName(email.fromName));
      return {
        domain,
        emails: sorted,
        guessedName: named?.fromName?.trim() ?? labelFromDomain(domain),
      };
    })
    .sort((a, b) => b.emails.length - a.emails.length);
}

/// Splits a sender's mail into batches the model reads in full.
///
/// Sampling was the original approach and it was wrong: a syndicate sends every
/// deal from one address, so 72 emails covering ten companies were represented
/// by six, and the other companies simply never existed as far as the scan was
/// concerned. Reading everything costs more calls and finds what is actually
/// there.
///
/// Batches run oldest first, because the earliest mail about a deal carries the
/// commitment and its terms, and the newest is usually a routine update.
export function evidenceBatches(
  group: DomainGroup,
  opts: { batchSize?: number; maxEmails?: number } = {},
): ScannedEmail[][] {
  const batchSize = opts.batchSize ?? 12;
  const maxEmails = opts.maxEmails ?? 240;

  const ordered = [...group.emails]
    .sort((a, b) => a.receivedAt.getTime() - b.receivedAt.getTime())
    .slice(0, maxEmails);

  const batches: ScannedEmail[][] = [];
  for (let index = 0; index < ordered.length; index += batchSize) {
    batches.push(ordered.slice(index, index + batchSize));
  }
  return batches;
}
