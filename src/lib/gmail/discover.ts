import "server-only";
import { prisma } from "@/lib/prisma";
import { decryptSecret } from "@/lib/crypto";
import { accessTokenFromRefresh, getMessage, listMessageIds } from "./client";
import { ingestAttachments } from "./attachments";
import { AUTO_MATCH_THRESHOLD, bestMatch, matchCompany, type MatchCandidate } from "./match";
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
  /// Stored as a new Update.
  created: number;
  /// Fetched, refused by the gate, and deliberately not stored. Nothing about
  /// these reaches the LLM.
  refused: number;
  autoMatched: number;
  documents: number;
}

export async function discoverUpdates(
  userId: string,
  opts: { sinceDays?: number; maxMessages?: number } = {},
): Promise<DiscoverResult> {
  const account = await prisma.gmailAccount.findUnique({ where: { userId } });
  if (!account) throw new Error("Connect Gmail first.");

  const accessToken = await accessTokenFromRefresh(decryptSecret(account.refreshTokenEncrypted));
  const query = buildDiscoveryQuery({ sinceDays: opts.sinceDays });
  const ids = await listMessageIds(accessToken, query, { maxMessages: opts.maxMessages ?? 200 });

  const stored = await prisma.update.findMany({
    where: { userId, gmailMessageId: { in: ids } },
    select: { gmailMessageId: true },
  });
  const knownIds = new Set(stored.map((row) => row.gmailMessageId));
  const newIds = ids.filter((id) => !knownIds.has(id));

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
    found: ids.length,
    known: knownIds.size,
    examined: 0,
    created: 0,
    refused: 0,
    autoMatched: 0,
    documents: 0,
  };

  for (const id of newIds) {
    let email;
    try {
      email = await getMessage(accessToken, id);
    } catch {
      // No row was written, so the next run sees this message again.
      continue;
    }
    result.examined += 1;
    if (!email.text.trim()) continue;

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
    // Same rule as the labelled sync: certain matches file themselves, and a
    // body that could not be read is never confirmed on its subject alone.
    const confident =
      match != null && match.confidence >= AUTO_MATCH_THRESHOLD && !email.truncated;

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
        ingestReason: verdict.reason,
        matchConfidence: match?.confidence ?? null,
        reviewState: confident ? "CONFIRMED" : "PENDING",
      },
    });

    result.created += 1;
    if (confident) result.autoMatched += 1;

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

  return result;
}
