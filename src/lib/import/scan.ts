import "server-only";
import { prisma } from "@/lib/prisma";
import { decryptSecret } from "@/lib/crypto";
import { extractStructured } from "@/lib/ai/client";
import { accessTokenFromRefresh, getMessage, listMessageIds } from "@/lib/gmail/client";
import { domainOf } from "@/lib/gmail/match";
import { evidenceFor, groupBySenderDomain, type DomainGroup, type ScannedEmail } from "./group";
import { ProposalSchema, type Proposal } from "./schema";

const SYSTEM = `You are reading a group of emails that all come from one company's domain, in the mailbox of an angel investor.

Decide whether these emails show that the investor actually invested money in this company, and if so, extract what the emails state about the company and the investment.

Rules:
- isInvestment is true only with real evidence of money invested: a signed SAFE or note, a wire or payment confirmation, a countersigned document, a closing confirmation, or investor updates addressed to existing investors.
- A cold pitch, a fundraising deck, a newsletter, a rejected deal, or an intro conversation is NOT an investment. Set isInvestment false and leave positions empty.
- Every position needs sourceQuote: the verbatim sentence evidencing it. If you cannot quote the amount, set amount to null rather than guessing. A missing number is fine; an invented one is not.
- Never infer terms from convention. If the cap is not written down, it is null.
- Investor updates addressed to a list of investors are strong evidence of an investment, even when they never restate the amount. In that case set isInvestment true with an empty positions array, and say so in notes.
- Report dates in ISO YYYY-MM-DD form.`;

function evidenceText(group: DomainGroup, emails: ScannedEmail[]): string {
  return [
    `Sender domain: ${group.domain}`,
    `Emails: ${group.emails.length}`,
    "",
    ...emails.map((email, index) =>
      [
        `--- Email ${index + 1} ---`,
        `Date: ${email.receivedAt.toISOString().slice(0, 10)}`,
        `From: ${email.fromName ? `${email.fromName} ` : ""}<${email.fromAddress}>`,
        `Subject: ${email.subject ?? "(none)"}`,
        "",
        // Bounded per email so one enormous forward cannot crowd out the rest.
        email.text.slice(0, 6000),
      ].join("\n"),
    ),
  ].join("\n\n");
}

export interface ScanResult {
  scanned: number;
  domains: number;
  proposed: number;
  skipped: number;
}

/// Reads the mailbox, groups by sender domain, and asks Claude which groups
/// represent real investments. Writes proposals only: nothing reaches the
/// portfolio until the user accepts it on /import.
export async function scanForCompanies(
  userId: string,
  opts: { query?: string; maxMessages?: number; minEmails?: number } = {},
): Promise<ScanResult> {
  const account = await prisma.gmailAccount.findUnique({ where: { userId } });
  if (!account) throw new Error("Connect Gmail first.");

  const accessToken = await accessTokenFromRefresh(decryptSecret(account.refreshTokenEncrypted));
  const query = opts.query ?? account.syncQuery;
  const ids = await listMessageIds(accessToken, query, { maxMessages: opts.maxMessages ?? 300 });

  // One unreadable message must not lose a scan that has already fetched
  // hundreds. Everything retryable is handled inside the client; what reaches
  // here is a message that genuinely cannot be read.
  const emails: ScannedEmail[] = [];
  let unreadable = 0;
  for (const id of ids) {
    try {
      const email = await getMessage(accessToken, id);
      if (email.text.trim()) emails.push(email);
    } catch {
      unreadable += 1;
    }
  }
  if (emails.length === 0 && unreadable > 0) {
    throw new Error(`Could not read any of the ${unreadable} messages Gmail returned.`);
  }

  // Domains already represented in the portfolio, so a rescan proposes only
  // what is genuinely new.
  const [companies, dismissed] = await Promise.all([
    prisma.company.findMany({
      where: { userId },
      select: { website: true, contacts: { select: { email: true } } },
    }),
    prisma.importCandidate.findMany({
      where: { userId, state: { in: ["IMPORTED", "DISMISSED"] } },
      select: { sourceDomain: true },
    }),
  ]);

  const knownDomains = new Set<string>();
  for (const company of companies) {
    const site = domainOf(company.website);
    if (site) knownDomains.add(site);
    for (const contact of company.contacts) {
      const contactDomain = domainOf(contact.email);
      if (contactDomain) knownDomains.add(contactDomain);
    }
  }
  for (const row of dismissed) knownDomains.add(row.sourceDomain);

  const groups = groupBySenderDomain(emails, { knownDomains, minEmails: opts.minEmails ?? 1 });

  let proposed = 0;
  let skipped = 0;

  for (const group of groups) {
    let proposal: Proposal;
    try {
      proposal = await extractStructured(
        SYSTEM,
        evidenceText(group, evidenceFor(group)),
        ProposalSchema,
      );
    } catch {
      // A group the model could not read is not a reason to abandon the scan.
      skipped += 1;
      continue;
    }

    if (!proposal.isInvestment) {
      // Remember the rejection so the next scan does not pay to re-read it.
      await prisma.importCandidate.upsert({
        where: { userId_sourceDomain: { userId, sourceDomain: group.domain } },
        create: {
          userId,
          sourceDomain: group.domain,
          proposedName: proposal.name || group.guessedName,
          payload: proposal,
          emailCount: group.emails.length,
          confidence: proposal.confidence,
          state: "DISMISSED",
        },
        update: { state: "DISMISSED", payload: proposal },
      });
      skipped += 1;
      continue;
    }

    await prisma.importCandidate.upsert({
      where: { userId_sourceDomain: { userId, sourceDomain: group.domain } },
      create: {
        userId,
        sourceDomain: group.domain,
        proposedName: proposal.name || group.guessedName,
        payload: proposal,
        emailCount: group.emails.length,
        confidence: proposal.confidence,
        state: "PROPOSED",
      },
      update: {
        proposedName: proposal.name || group.guessedName,
        payload: proposal,
        emailCount: group.emails.length,
        confidence: proposal.confidence,
        state: "PROPOSED",
      },
    });
    proposed += 1;
  }

  return { scanned: emails.length, domains: groups.length, proposed, skipped };
}
