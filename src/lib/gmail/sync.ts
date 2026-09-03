import "server-only";
import { prisma } from "@/lib/prisma";
import { decryptSecret } from "@/lib/crypto";
import { accessTokenFromRefresh, getMessage, listMessageIds } from "./client";
import { AUTO_MATCH_THRESHOLD, matchCompany, type MatchCandidate } from "./match";

export interface SyncResult {
  fetched: number;
  created: number;
  autoMatched: number;
  pending: number;
}

/// Pulls messages matching the account's sync query and stores the new ones as
/// Update rows. Extraction is a separate pass: ingest must not depend on the
/// LLM being reachable, and a stored email can always be re-extracted.
export async function syncGmail(userId: string, opts: { maxMessages?: number } = {}): Promise<SyncResult> {
  const account = await prisma.gmailAccount.findUnique({ where: { userId } });
  if (!account) throw new Error("No Gmail account connected.");

  const accessToken = await accessTokenFromRefresh(decryptSecret(account.refreshTokenEncrypted));
  const ids = await listMessageIds(accessToken, account.syncQuery, opts);

  // Skip anything already stored: message ids are stable, so this is the whole
  // deduplication story.
  const known = await prisma.update.findMany({
    where: { userId, gmailMessageId: { in: ids } },
    select: { gmailMessageId: true },
  });
  const knownIds = new Set(known.map((row) => row.gmailMessageId));
  const newIds = ids.filter((id) => !knownIds.has(id));

  const companies = await prisma.company.findMany({
    where: { userId },
    select: { id: true, name: true, website: true, contacts: { select: { email: true } } },
  });
  const candidates: MatchCandidate[] = companies.map((company) => ({
    companyId: company.id,
    name: company.name,
    website: company.website,
    contactEmails: company.contacts.map((contact) => contact.email).filter((email): email is string => !!email),
  }));

  let created = 0;
  let autoMatched = 0;

  for (const id of newIds) {
    const email = await getMessage(accessToken, id);
    if (!email.text.trim()) continue;

    const match = matchCompany(email, candidates);
    const confident = match != null && match.confidence >= AUTO_MATCH_THRESHOLD;

    await prisma.update.create({
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
        matchConfidence: match?.confidence ?? null,
        // Only a certain match is confirmed outright. Everything else waits for
        // a human, which is what keeps a mis-filed update from silently
        // becoming another company's metrics.
        reviewState: confident ? "CONFIRMED" : "PENDING",
      },
    });

    created += 1;
    if (confident) autoMatched += 1;
  }

  await prisma.gmailAccount.update({
    where: { userId },
    data: { lastSyncedAt: new Date() },
  });

  const pending = await prisma.update.count({ where: { userId, reviewState: "PENDING" } });

  return { fetched: ids.length, created, autoMatched, pending };
}
