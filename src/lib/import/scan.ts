import "server-only";
import { prisma } from "@/lib/prisma";
import { decryptSecret } from "@/lib/crypto";
import { extractStructured } from "@/lib/ai/client";
import { accessTokenFromRefresh, getMessage, listMessageIds } from "@/lib/gmail/client";
import { domainOf } from "@/lib/gmail/match";
import { evidenceFor, groupBySenderDomain, type DomainGroup, type ScannedEmail } from "./group";
import { ScanGroupSchema, type ScanGroup } from "./schema";
import { bumpRun, updateRun } from "@/lib/progress";

const SYSTEM = `You are reading a group of emails that all come from one sender domain, in the mailbox of an angel investor.

Work out which operating companies the investor actually put money into, and extract what the emails state about each one.

Syndicates and SPVs are the case that matters most:
- If the sender is a syndicate, SPV manager or investment platform (Viaka, AngelList, Carta, Republic, Allocations, and the like), the SENDER IS NOT A PORTFOLIO COMPANY. Never propose it.
- Instead, return one entry per underlying operating company the emails show an investment in, and set investmentGroup to the manager's name on each. Three deals through one syndicate means three entries.
- Set senderIsSyndicate true in that case.
- For a direct investment from a company's own domain, return that one company with investmentGroup null.

Amounts are where this goes wrong, so be strict:
- amount is the READER's own investment. An SPV's total raise, the round size, or another investor's cheque is never the reader's amount. If only a total is stated, set amount null and say so in notes.
- feesAmount is anything the reader paid on top: legal, admin, setup or carry paid up front.
- amountConfirmed is true only when the emails show the money actually moved. A commitment with a future wire deadline is false, however firm the language.

General rules:
- Only report what the emails state. Never infer, never estimate, never fill a gap with a plausible number.
- Every position needs sourceQuote: the verbatim sentence evidencing it. If you cannot quote the amount, set it null rather than guessing.
- A cold pitch, a fundraising deck, a newsletter or a rejected deal is not an investment. Return an empty companies array with a one-line skippedReason.
- Investor updates addressed to existing investors are strong evidence, even when they never restate the amount. Include the company with an empty positions array and say so in notes.
- A countersigned document listed under Attachments (a SAFE, note or subscription agreement) is strong evidence of an investment even when the covering email is one line. The document's contents are read separately, so do not invent terms from its filename.
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
        email.attachments.length > 0
          ? `Attachments: ${email.attachments.map((a) => a.filename).join(", ")}`
          : "Attachments: none",
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
  opts: { query?: string; maxMessages?: number; minEmails?: number; runId?: string } = {},
): Promise<ScanResult> {
  const runId = opts.runId;
  const account = await prisma.gmailAccount.findUnique({ where: { userId } });
  if (!account) throw new Error("Connect Gmail first.");

  const accessToken = await accessTokenFromRefresh(decryptSecret(account.refreshTokenEncrypted));
  const query = opts.query ?? account.syncQuery;
  await updateRun(runId, { step: "Searching your mailbox" });
  const ids = await listMessageIds(accessToken, query, { maxMessages: opts.maxMessages ?? 300 });
  await updateRun(runId, {
    step: `Reading ${ids.length} messages`,
    totalItems: ids.length,
    doneItems: 0,
  });

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
    // Every tenth message keeps the progress bar honest without a write per
    // message.
    if ((emails.length + unreadable) % 10 === 0) {
      await bumpRun(runId, { doneItems: 10 });
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
      select: { sourceDomain: true, state: true, investmentGroup: true },
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
  // Skip a domain once it is settled, with one exception: a syndicate keeps
  // sending new deals from the same address, so importing Asendia from Viaka
  // must not stop the next scan finding Pintours.
  for (const row of dismissed) {
    const isSyndicateDomain = row.investmentGroup != null;
    if (row.state === "DISMISSED" || !isSyndicateDomain) knownDomains.add(row.sourceDomain);
  }
  for (const row of dismissed) {
    if (row.investmentGroup != null && row.state === "IMPORTED") knownDomains.delete(row.sourceDomain);
  }

  const groups = groupBySenderDomain(emails, { knownDomains, minEmails: opts.minEmails ?? 1 });
  await updateRun(runId, {
    step: `Reviewing ${groups.length} senders`,
    totalItems: groups.length,
    doneItems: 0,
  });

  let proposed = 0;
  let skipped = 0;

  for (const group of groups) {
    let result: ScanGroup;
    try {
      result = await extractStructured(
        SYSTEM,
        evidenceText(group, evidenceFor(group)),
        ScanGroupSchema,
      );
    } catch {
      // A group the model could not read is not a reason to abandon the scan.
      skipped += 1;
      await bumpRun(runId, { doneItems: 1 });
      continue;
    }

    // Replace this domain's outstanding proposals rather than merging with
    // them: a rescan is the newer, better reading, and a syndicate's company
    // list changes between scans. Imported and dismissed rows are untouched.
    await prisma.importCandidate.deleteMany({
      where: { userId, sourceDomain: group.domain, state: "PROPOSED" },
    });

    if (result.companies.length === 0) {
      // Remember the rejection so the next scan does not pay to re-read it. The
      // domain, not a company name, is what gets skipped next time.
      await prisma.importCandidate.upsert({
        where: {
          userId_sourceDomain_proposedName: {
            userId,
            sourceDomain: group.domain,
            proposedName: group.guessedName,
          },
        },
        create: {
          userId,
          sourceDomain: group.domain,
          proposedName: group.guessedName,
          payload: { skippedReason: result.skippedReason },
          emailCount: group.emails.length,
          state: "DISMISSED",
        },
        update: { state: "DISMISSED", payload: { skippedReason: result.skippedReason } },
      });
      skipped += 1;
      await bumpRun(runId, { doneItems: 1, step: `Reviewed ${group.domain}` });
      continue;
    }

    // One candidate per underlying company. A syndicate domain covering three
    // deals produces three rows, each carrying the manager as its group.
    for (const proposal of result.companies) {
      const proposedName = proposal.name?.trim() || group.guessedName;

      await prisma.importCandidate.upsert({
        where: {
          userId_sourceDomain_proposedName: { userId, sourceDomain: group.domain, proposedName },
        },
        create: {
          userId,
          sourceDomain: group.domain,
          investmentGroup: proposal.investmentGroup,
          proposedName,
          payload: proposal,
          emailCount: group.emails.length,
          confidence: proposal.confidence,
          state: "PROPOSED",
        },
        update: {
          investmentGroup: proposal.investmentGroup,
          payload: proposal,
          emailCount: group.emails.length,
          confidence: proposal.confidence,
          state: "PROPOSED",
        },
      });
      proposed += 1;
    }

    // Written before the next sender is read, which is what lets the page show
    // proposals arriving rather than all at once at the end.
    await bumpRun(runId, {
      doneItems: 1,
      produced: result.companies.length,
      step: `Found ${result.companies.map((company) => company.name).join(", ")}`,
    });
  }

  return { scanned: emails.length, domains: groups.length, proposed, skipped };
}
