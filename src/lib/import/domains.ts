// Which domains can stand for a company, and which never can.
//
// This matters more than it looks. A domain is the strongest signal for
// deciding two records are the same business, so letting a syndicate's or a
// bank's domain masquerade as a company website makes every company that
// syndicate ever emailed about look identical, and merges them into one.

/// Domains that can never be a company's own website. Broad on purpose: this
/// governs IDENTITY, and letting a syndicate's or bank's domain stand for a
/// company merges every company they wrote about into one.
///
/// It deliberately does NOT govern whose mail is worth reading. A syndicate's
/// domain is where the deals are, and a bank's is where the transfers are, so
/// both are read and neither is ever a website. See NON_GROUPING_DOMAINS.
export const NON_COMPANY_DOMAINS = new Set([
  // Consumer mail
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "hotmail.com",
  "yahoo.com",
  "icloud.com",
  "me.com",
  "aol.com",
  "proton.me",
  "protonmail.com",
  // Bulk senders and infrastructure
  "substack.com",
  "mailchimp.com",
  "mailchimpapp.net",
  "sendgrid.net",
  "mailgun.org",
  "docusign.net",
  "docusign.com",
  "hellosign.com",
  "dropbox.com",
  "notion.so",
  "google.com",
  "linkedin.com",
  // Syndicates, SPV managers and investment platforms
  "carta.com",
  "angellist.com",
  "republic.com",
  "wefunder.com",
  "allocations.com",
  "sydecar.io",
  "assure.co",
  "vauban.io",
  "odin.co",
  "viaka.net",
  "viaka.com",
  // Banks and money movement
  "bankofamerica.com",
  "chase.com",
  "wellsfargo.com",
  "citi.com",
  "citibank.com",
  "hsbc.com",
  "schwab.com",
  "fidelity.com",
  "mercury.com",
  "brex.com",
  "ramp.com",
  "stripe.com",
  "wise.com",
  "revolut.com",
  "svb.com",
  "firstrepublic.com",
]);

/// Subdomains that announce infrastructure rather than a business: a company
/// site is never at mail.transfers.example.com.
const INFRASTRUCTURE_PREFIXES = [
  "mail.",
  "email.",
  "mailer.",
  "transfers.",
  "notifications.",
  "notification.",
  "alerts.",
  "no-reply.",
  "noreply.",
  "bounce.",
  "click.",
  "track.",
  "links.",
  "secure.",
];

export function baseDomain(domain: string): string {
  const parts = domain.toLowerCase().split(".").filter(Boolean);
  if (parts.length <= 2) return parts.join(".");

  // Handle the common two-part public suffixes without a full PSL.
  const twoPart = new Set(["co.uk", "com.au", "co.nz", "co.jp", "com.br", "co.za"]);
  const lastTwo = parts.slice(-2).join(".");
  return twoPart.has(lastTwo) ? parts.slice(-3).join(".") : lastTwo;
}

/// True when a domain could plausibly be a company's own website.
export function isCompanyDomain(domain: string | null | undefined): boolean {
  if (!domain) return false;
  const host = domain.toLowerCase().replace(/^www\./, "");
  if (!host.includes(".")) return false;

  if (INFRASTRUCTURE_PREFIXES.some((prefix) => host.startsWith(prefix))) return false;
  if (NON_COMPANY_DOMAINS.has(host)) return false;
  return !NON_COMPANY_DOMAINS.has(baseDomain(host));
}


/// Senders whose mail is not worth grouping into a company at all: consumer
/// mail hosts and bulk marketing infrastructure. Everything else is read,
/// including syndicates, banks and e-signature providers, because that is where
/// the deals, the transfers and the signatures live.
export const NON_GROUPING_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "hotmail.com",
  "yahoo.com",
  "icloud.com",
  "me.com",
  "aol.com",
  "proton.me",
  "protonmail.com",
  "substack.com",
  "mailchimp.com",
  "mailchimpapp.net",
  "sendgrid.net",
  "mailgun.org",
  "linkedin.com",
  "google.com",
]);

export function isGroupableSender(domain: string | null | undefined): boolean {
  if (!domain) return false;
  const host = domain.toLowerCase().replace(/^www\./, "");
  if (NON_GROUPING_DOMAINS.has(host)) return false;
  return !NON_GROUPING_DOMAINS.has(baseDomain(host));
}
