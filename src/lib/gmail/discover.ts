import "server-only";
import { prisma } from "@/lib/prisma";
import { decryptSecret } from "@/lib/crypto";
import { accessTokenFromRefresh, getMessage, listMessageIds } from "./client";
import { ingestAttachments } from "./attachments";
import { bestMatch, matchCompany, type MatchCandidate } from "./match";
import { matchCompanyByContent } from "./content-match";
import { buildDiscoveryQuery, classifyMail } from "./discovery";

// Ingest for mail the user never labelled.
//
// The label-based sync reads what the user filed. This reads what they did not,
// by searching the mailbox for the vocabulary of an investment and storing only
// what a deterministic gate accepts. Every stored row keeps the gate's reason,
// because an email the user never filed turning up in their review queue has to
// be explicable.

export interface DiscoverResult {
  /// Messages the Gmail query returned.
  found: number;
  /// Already stored, so not looked at again.
  known: number;
  /// Fetched and shown to the gate.
  examined: number;
  /// Stored as a new Update, always pending review.
  created: number;
  /// Fetched, refused by the gate, and deliberately not stored. Nothing about
  /// these reaches the LLM.
  refused: number;
  /// True once the whole window has been walked, so later runs only look at
  /// new arrivals. False means there is still older mail to reach.
  backfilled: boolean;
  documents: number;
}

export async function discoverUpdates(
  userId: string,
  opts: { sinceDays?: number; maxMessages?: number } = {},
): Promise<DiscoverResult> {
  const account = await prisma.gmailAccount.findUnique({ where: { userId } });
  if (!account) throw new Error("Connect Gmail first.");

  const sinceDays = opts.sinceDays ?? account.discoverDays;
  const ownAddress = account.emailAddress.toLowerCase();
  const maxMessages = opts.maxMessages ?? 200;
  const accessToken = await accessTokenFromRefresh(decryptSecret(account.refreshTokenEncrypted));

  const companies = await prisma.company.findMany({
    where: { userId },
    select: { id: true, name: true, website: true, contacts: { select: { email: true } } },
  });
  const candidates: MatchCandidate[] = companies.map((company) => ({
    companyId: company.id,
    name: company.name,
    website: company.website,
    contactEmails: company.contacts
      .map((contact) => contact.email)
      .filter((email): email is string => !!email),
  }));

  const result: DiscoverResult = {
    found: 0,
    known: 0,
    examined: 0,
    created: 0,
    refused: 0,
    backfilled: account.discoverBackfilledAt != null,
    documents: 0,
  };

  /// One pass over one query. Returns how many ids Gmail offered, which is what
  /// says whether the window is exhausted, and the oldest message it examined,
  /// which is where the next backfill pass starts.
  async function pass(before?: Date): Promise<{ offered: number; oldest: Date | null }> {
    const query = buildDiscoveryQuery({ sinceDays, before });
    const ids = await listMessageIds(accessToken, query, { maxMessages });
    result.found += ids.length;

    const stored = await prisma.update.findMany({
      where: { userId, gmailMessageId: { in: ids } },
      select: { gmailMessageId: true, receivedAt: true },
    });
    const knownIds = new Set(stored.map((row) => row.gmailMessageId));
    result.known += knownIds.size;

    // Seeded from the mail already stored, not only from what this pass fetches.
    // A page whose every id is known (the label sync got there first) would
    // otherwise leave the cursor null, and with no cursor there is nowhere to
    // walk back from: the backfill would never start at all.
    let oldest: Date | null = null;
    for (const row of stored) {
      if (!oldest || row.receivedAt < oldest) oldest = row.receivedAt;
    }

    for (const id of ids) {
      if (knownIds.has(id)) continue;

      let email;
      try {
        email = await getMessage(accessToken, id);
      } catch {
        // No row was written, so the next run sees this message again.
        continue;
      }
      result.examined += 1;
      // The cursor tracks what was CONSIDERED, not what was kept. A page of mail
      // the gate refuses still has to move the cursor, or the backfill stalls on
      // it forever.
      if (!oldest || email.receivedAt < oldest) oldest = email.receivedAt;
      if (!email.text.trim()) continue;

      // The query excludes Sent, but a self-addressed copy or a Bcc to oneself
      // still arrives in the inbox. An email the user wrote is evidence of what
      // they said, never a company's report on itself.
      if (email.fromAddress.toLowerCase() === ownAddress) {
        result.refused += 1;
        continue;
      }

      const verdict = classifyMail({
        subject: email.subject,
        fromAddress: email.fromAddress,
        text: email.text,
        attachmentNames: email.attachments.map((attachment) => attachment.filename),
        bulk: email.bulk,
      });
      if (!verdict.keep) {
        result.refused += 1;
        continue;
      }

      const match = bestMatch(
        matchCompany(email, candidates),
        matchCompanyByContent(
          email.text,
          candidates.map((candidate) => ({ companyId: candidate.companyId, name: candidate.name })),
          { subject: email.subject },
        ),
      );

      const created = await prisma.update.create({
        data: {
          userId,
          companyId: match?.companyId ?? null,
          gmailMessageId: email.gmailMessageId,
          gmailThreadId: email.gmailThreadId,
          receivedAt: email.receivedAt,
          fromAddress: email.fromAddress,
          fromName: email.fromName,
          subject: email.subject,
          rawText: email.text,
          ingestIssue: email.truncated ? "TRUNCATED_BODY" : null,
          // This path fetches attachments as it stores the row, so the backfill
          // has nothing to do here.
          attachmentsCheckedAt: new Date(),
          ingestReason: verdict.reason,
          matchConfidence: match?.confidence ?? null,
          // Always pending, unlike the labelled sync and the company scan.
          // Those two know why an email is theirs: the user filed it, or the
          // company's own domain sent it. Discovery only knows that the words
          // looked right, and a third party merely naming a company scores high
          // enough on content to be filed against it. Auto-confirming here would
          // also hide the row from the one page that shows `ingestReason`, so the
          // emails that most need a human are the ones nobody would see.
          reviewState: "PENDING",
          links: email.links,
        },
      });

      result.created += 1;

      if (email.attachments.length > 0) {
        const attachments = await ingestAttachments(userId, {
          accessToken,
          updateId: created.id,
          companyId: match?.companyId ?? null,
          gmailMessageId: email.gmailMessageId,
          attachments: email.attachments,
        });
        result.documents += attachments.stored;
      }
    }

    return { offered: ids.length, oldest };
  }

  // Pass one, unbounded: whatever is newest. This is what catches arrivals, and
  // on a mailbox inside the cap it is the only pass that does anything.
  const newest = await pass();

  // Pass two walks backwards, and only while there is somewhere to walk. Gmail
  // answers newest first and truncates at the cap, so on a mailbox with more
  // matches than that, pass one alone reads the same page every run and the
  // older mail is never reached. One pass per run drains it steadily instead of
  // spending an hour on the first sync.
  let oldestSeen = newest.oldest;

  if (!result.backfilled) {
    const from = account.discoverOldestAt ?? newest.oldest;
    if (from) {
      const older = await pass(from);
      if (older.oldest && (!oldestSeen || older.oldest < oldestSeen)) oldestSeen = older.oldest;
      // Short of the cap means Gmail had nothing more to offer before that
      // boundary, so the window is drained.
      result.backfilled = older.offered < maxMessages;
    }
  }

  // The cursor only ever moves backwards, so a pass that happens to see newer
  // mail cannot undo the ground already covered.
  const oldestCursor = [oldestSeen, account.discoverOldestAt]
    .filter((date): date is Date => date != null)
    .sort((a, b) => a.getTime() - b.getTime())[0];

  await prisma.gmailAccount.update({
    where: { userId },
    data: {
      ...(oldestCursor ? { discoverOldestAt: oldestCursor } : {}),
      ...(result.backfilled && !account.discoverBackfilledAt
        ? { discoverBackfilledAt: new Date() }
        : {}),
    },
  });

  return result;
}
