import "server-only";
import { prisma } from "@/lib/prisma";
import { decryptSecret } from "@/lib/crypto";
import { extractStructured } from "@/lib/ai/client";
import { accessTokenFromRefresh, getMessage, listMessageIds } from "@/lib/gmail/client";
import { domainOf } from "@/lib/gmail/match";
import { evidenceBatches, groupBySenderDomain, type DomainGroup, type ScannedEmail } from "./group";
import { canonicalCompanyKey } from "./identity";
import { mergeProposals } from "./merge";
import { CompanyProposalSchema, type Proposal } from "./schema";
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
- The reader is the investor whose mailbox this is. Their OWN replies are in these batches, quoted as "From: <their address>", and a reply saying how much they are in for is the single best evidence of their commitment. Prefer it over any figure a syndicate or company states, and set statedBy INVESTOR for it.
- statedBy records who wrote the email an amount came from, so a commitment the reader made is never confused with a round size someone else announced.
- amount is the READER's own investment. An SPV's total raise, the round size, or another investor's cheque is never the reader's amount. If only a total is stated, set amount null and say so in notes.
- feesAmount is anything the reader paid on top: legal, admin, setup or carry paid up front.
- amountConfirmed is true only when the emails show the money actually moved. A commitment with a future wire deadline is false, however firm the language.

General rules:
- Only report what the emails state. Never infer, never estimate, never fill a gap with a plausible number.
- Every position needs sourceQuote: the verbatim sentence evidencing it. If you cannot quote the amount, set it null rather than guessing.
- A cold pitch, a fundraising deck, a newsletter or a rejected deal is not an investment. Return an empty companies array with a one-line skippedReason.
- Investor updates addressed to existing investors are strong evidence, even when they never restate the amount. Include the company with an empty positions array and say so in notes.
- A countersigned document listed under Attachments (a SAFE, note or subscription agreement) is strong evidence of an investment even when the covering email is one line. The document's contents are read separately, so do not invent terms from its filename.
- Use the Links list to identify each company's own website, which is the single most useful field for keeping one company from being entered twice. Prefer the company's own domain, and set website to null unless you can see it. NEVER use the sender's domain as a website: a syndicate, bank, or e-signature provider describes how the mail arrived, not who the company is. A document host or deal-room link is not a website either.
- Report dates in ISO YYYY-MM-DD form.`;

/// The mailbox owner's own address, so their replies can be marked as theirs in
/// the evidence. Without it the model cannot tell a commitment from an
/// announcement.
let mailboxOwner: string | null = null;

function evidenceText(group: DomainGroup, emails: ScannedEmail[]): string {
  return [
    `Sender domain: ${group.domain}`,
    `Emails in this batch: ${emails.length} of ${group.emails.length} from this sender`,
    "",
    ...emails.map((email, index) =>
      [
        `--- Email ${index + 1} ---`,
        `Date: ${email.receivedAt.toISOString().slice(0, 10)}`,
        `From: ${email.fromName ? `${email.fromName} ` : ""}<${email.fromAddress}>${
          mailboxOwner && email.fromAddress.toLowerCase() === mailboxOwner ? " (the reader)" : ""
        }`,
        `Subject: ${email.subject ?? "(none)"}`,
        email.attachments.length > 0
          ? `Attachments: ${email.attachments.map((a) => a.filename).join(", ")}`
          : "Attachments: none",
        email.links.length > 0 ? `Links: ${email.links.slice(0, 10).join(", ")}` : "Links: none",
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
  /// Senders with nothing new since the last scan, read from neither Gmail nor
  /// the model.
  unchanged: number;
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

  mailboxOwner = account.emailAddress.toLowerCase();
  const accessToken = await accessTokenFromRefresh(decryptSecret(account.refreshTokenEncrypted));
  const query = opts.query ?? account.syncQuery;
  await updateRun(runId, { step: "Searching your mailbox" });
  const ids = await listMessageIds(accessToken, query, { maxMessages: opts.maxMessages ?? 300 });

  // Anything already stored is read from the database rather than fetched
  // again. A rescan of a mailbox that has not changed then costs one search
  // instead of hundreds of message reads, which is most of the wall clock and
  // all of the Gmail quota.
  const stored = await prisma.update.findMany({
    where: { userId, gmailMessageId: { in: ids } },
    select: {
      gmailMessageId: true,
      importScannedAt: true,
      gmailThreadId: true,
      receivedAt: true,
      fromAddress: true,
      fromName: true,
      subject: true,
      rawText: true,
      links: true,
    },
  });
  const storedById = new Map(stored.map((row) => [row.gmailMessageId, row]));
  const toFetch = ids.filter((id) => !storedById.has(id));

  await updateRun(runId, {
    step: toFetch.length > 0 ? `Reading ${toFetch.length} new messages` : "Reading stored mail",
    totalItems: toFetch.length,
    doneItems: 0,
  });

  // One unreadable message must not lose a scan that has already fetched
  // hundreds. Everything retryable is handled inside the client; what reaches
  // here is a message that genuinely cannot be read.
  const alreadyRead = new Set(
    stored.filter((row) => row.importScannedAt != null).map((row) => row.gmailMessageId),
  );

  const emails: ScannedEmail[] = stored.map((row) => ({
    gmailMessageId: row.gmailMessageId,
    gmailThreadId: row.gmailThreadId,
    receivedAt: row.receivedAt,
    fromAddress: row.fromAddress,
    fromName: row.fromName,
    subject: row.subject,
    text: row.rawText,
    links: row.links,
    // Attachment names are only needed as evidence for a first read; a stored
    // message has already been through that.
    attachments: [],
  }));

  let unreadable = 0;
  for (const id of toFetch) {
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

  // Keep what was read. Without this an import produces companies with no
  // history: the scan read every email and discarded it, so the amounts stayed
  // in the mailbox. They are stored unmatched here and filed the moment their
  // company is accepted. Attachments are left to the next sync, which keeps the
  // scan fast.
  await updateRun(runId, { step: "Storing what it read" });
  for (const email of emails) {
    if (storedById.has(email.gmailMessageId)) continue;
    await prisma.update.create({
      data: {
        userId,
        gmailMessageId: email.gmailMessageId,
        gmailThreadId: email.gmailThreadId,
        receivedAt: email.receivedAt,
        fromAddress: email.fromAddress,
        fromName: email.fromName,
        subject: email.subject,
        rawText: email.text,
        links: email.links,
        reviewState: "PENDING",
      },
    });
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
  let unchanged = 0;

  // Keyed by company, across every sender. A syndicate, a bank, an e-signature
  // provider and the investor's own reply all describe one deal, and keying by
  // sender is what turned that into four cards and three positions.
  const byCompany = new Map<string, { proposal: Proposal; domains: Set<string> }>();

  for (const group of groups) {
    // Every email from this sender is read, in batches. Sampling was the
    // original approach and it lost whole companies: a syndicate sends every
    // deal from one address, so six emails out of seventy-two described six
    // emails, not the portfolio.
    const unread = {
      ...group,
      emails: group.emails.filter((email) => !alreadyRead.has(email.gmailMessageId)),
    };

    // Nothing new from this sender: no model call at all. This is what makes a
    // rescan cheap, since the fetch was already being skipped for stored mail.
    if (unread.emails.length === 0) {
      unchanged += 1;
      await bumpRun(runId, { doneItems: 1, step: `${group.domain}: nothing new` });
      continue;
    }

    const batches = evidenceBatches(unread);
    let skippedReason: string | null = null;
    let readAny = false;

    for (const [index, batch] of batches.entries()) {
      let result: ScanGroup;
      try {
        result = await extractStructured(
          SYSTEM,
          evidenceText(group, batch),
          ScanGroupSchema,
        );
      } catch {
        // One unreadable batch does not lose the others.
        continue;
      }
      readAny = true;
      skippedReason ??= result.skippedReason;

      for (const proposal of result.companies) {
        const key = canonicalCompanyKey(proposal.name || group.guessedName, {
          vehicle: proposal.investmentGroup,
        });
        if (!key) continue;

        const entry = byCompany.get(key);
        byCompany.set(key, {
          proposal: mergeProposals(entry?.proposal, proposal),
          domains: (entry?.domains ?? new Set<string>()).add(group.domain),
        });
      }

      // Stamped per batch rather than at the end, so an interrupted scan does
      // not re-read everything it already paid for.
      await prisma.update.updateMany({
        where: { userId, gmailMessageId: { in: batch.map((email) => email.gmailMessageId) } },
        data: { importScannedAt: new Date() },
      });

      await bumpRun(runId, {
        step: `${group.domain}: read ${Math.min((index + 1) * batch.length, unread.emails.length)} of ${unread.emails.length} new emails, ${byCompany.size} compan${byCompany.size === 1 ? "y" : "ies"} so far`,
      });
    }

    if (!readAny) {
      skipped += 1;
      await bumpRun(runId, { doneItems: 1 });
      continue;
    }
    if (skippedReason && byCompany.size === 0) skipped += 1;

    await bumpRun(runId, { doneItems: 1, step: `${group.domain}: done` });
  }

  // Written once, after every sender has been read, so a company described by
  // four of them is one row carrying what all four knew.
  await updateRun(runId, { step: "Merging what each sender said" });

  const settled = new Set(
    (
      await prisma.importCandidate.findMany({
        where: { userId, state: { in: ["IMPORTED", "DISMISSED"] } },
        select: { canonicalName: true },
      })
    ).map((row) => row.canonicalName),
  );

  for (const [key, entry] of byCompany) {
    // An earlier decision stands: a company already imported or dismissed is
    // not proposed again.
    if (settled.has(key)) continue;

    const existing = await prisma.importCandidate.findUnique({
      where: { userId_canonicalName: { userId, canonicalName: key } },
    });

    // Merge with an earlier scan's reading, since this run only read new mail.
    let proposal = entry.proposal;
    const domains = new Set(entry.domains);
    if (existing) {
      const parsed = CompanyProposalSchema.safeParse(existing.payload);
      if (parsed.success) proposal = mergeProposals(parsed.data, proposal);
      for (const domain of existing.sourceDomains) domains.add(domain);
    }

    await prisma.importCandidate.upsert({
      where: { userId_canonicalName: { userId, canonicalName: key } },
      create: {
        userId,
        canonicalName: key,
        proposedName: proposal.name,
        sourceDomain: [...domains][0] ?? "",
        sourceDomains: [...domains],
        investmentGroup: proposal.investmentGroup,
        payload: proposal,
        emailCount: emails.length,
        confidence: proposal.confidence,
        state: "PROPOSED",
      },
      update: {
        proposedName: proposal.name,
        sourceDomains: [...domains],
        investmentGroup: proposal.investmentGroup,
        payload: proposal,
        confidence: proposal.confidence,
        state: "PROPOSED",
      },
    });
    proposed += 1;
  }

  return { scanned: emails.length, domains: groups.length, proposed, skipped, unchanged };
}
