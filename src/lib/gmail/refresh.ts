import "server-only";
import { prisma } from "@/lib/prisma";
import { decryptSecret } from "@/lib/crypto";
import { accessTokenFromRefresh, getMessage, listMessageIds } from "./client";
import { ingestAttachments } from "./attachments";
import { buildUpdateQueries, type CompanySender } from "./company-queries";
import { domainOf } from "./match";

// Scanning for updates from companies already in the portfolio.
//
// Distinct from the label-based sync: this searches by who sent the mail rather
// than how it was filed, so an update the user never labelled is still found.
// Matching is certain by construction, because the query is built from the
// company's own domain and contacts, so results are confirmed rather than
// queued for review.

export interface RefreshResult {
  companies: number;
  found: number;
  created: number;
  documents: number;
}

export async function scanCompanyUpdates(
  userId: string,
  opts: { companyId?: string; sinceDays?: number; maxMessagesPerQuery?: number } = {},
): Promise<RefreshResult> {
  const account = await prisma.gmailAccount.findUnique({ where: { userId } });
  if (!account) throw new Error("Connect Gmail first.");

  const companies = await prisma.company.findMany({
    where: { userId, ...(opts.companyId ? { id: opts.companyId } : {}) },
    select: { id: true, name: true, website: true, contacts: { select: { email: true } } },
  });

  const senders: CompanySender[] = companies.map((company) => ({
    companyId: company.id,
    name: company.name,
    website: company.website,
    contactEmails: company.contacts
      .map((contact) => contact.email)
      .filter((email): email is string => !!email),
  }));

  // Which company an address belongs to, resolved once rather than per message.
  const byDomain = new Map<string, string>();
  const byAddress = new Map<string, string>();
  for (const sender of senders) {
    const domain = domainOf(sender.website);
    if (domain) byDomain.set(domain, sender.companyId);
    for (const email of sender.contactEmails) byAddress.set(email.toLowerCase(), sender.companyId);
  }

  const accessToken = await accessTokenFromRefresh(decryptSecret(account.refreshTokenEncrypted));
  const queries = buildUpdateQueries(senders, { sinceDays: opts.sinceDays });

  let found = 0;
  let created = 0;
  let documents = 0;

  for (const query of queries) {
    const ids = await listMessageIds(accessToken, query, {
      maxMessages: opts.maxMessagesPerQuery ?? 150,
    });
    found += ids.length;

    const known = await prisma.update.findMany({
      where: { userId, gmailMessageId: { in: ids } },
      select: { gmailMessageId: true },
    });
    const knownIds = new Set(known.map((row) => row.gmailMessageId));

    for (const id of ids.filter((messageId) => !knownIds.has(messageId))) {
      let email;
      try {
        email = await getMessage(accessToken, id);
      } catch {
        continue;
      }
      if (!email.text.trim()) continue;

      const companyId =
        byAddress.get(email.fromAddress.toLowerCase()) ??
        (domainOf(email.fromAddress) ? byDomain.get(domainOf(email.fromAddress)!) : undefined);
      // The query was built from these senders, so a miss here means the address
      // matched a batch mate rather than this company; skip rather than guess.
      if (!companyId) continue;

      const update = await prisma.update.create({
        data: {
          userId,
          companyId,
          gmailMessageId: email.gmailMessageId,
          gmailThreadId: email.gmailThreadId,
          receivedAt: email.receivedAt,
          fromAddress: email.fromAddress,
          fromName: email.fromName,
          subject: email.subject,
          rawText: email.text,
          links: email.links,
          matchConfidence: 1,
          reviewState: "CONFIRMED",
        },
      });
      created += 1;

      if (email.attachments.length > 0) {
        const result = await ingestAttachments(userId, {
          accessToken,
          updateId: update.id,
          companyId,
          gmailMessageId: email.gmailMessageId,
          attachments: email.attachments,
        });
        documents += result.stored;
      }
    }
  }

  return { companies: senders.length, found, created, documents };
}
