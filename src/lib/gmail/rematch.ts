import "server-only";
import { prisma } from "@/lib/prisma";
import { AUTO_MATCH_THRESHOLD, matchCompany, type MatchCandidate } from "./match";
import { matchCompanyByContent } from "./content-match";

// Re-matching updates that are stuck in the review queue.
//
// The case this exists for: mail synced before the portfolio had any companies
// matched against nothing and was filed as pending. Companies arrived later and
// nothing went back to look again, so extraction never ran and no amount was
// ever recorded. Any run of this after companies change picks them up.

export interface RematchResult {
  considered: number;
  matched: number;
  stillPending: number;
}

export async function rematchPendingUpdates(userId: string): Promise<RematchResult> {
  const [pending, companies] = await Promise.all([
    prisma.update.findMany({
      where: { userId, reviewState: "PENDING" },
      select: { id: true, fromAddress: true, subject: true, rawText: true },
    }),
    prisma.company.findMany({
      where: { userId },
      select: { id: true, name: true, website: true, contacts: { select: { email: true } } },
    }),
  ]);

  if (companies.length === 0) {
    return { considered: pending.length, matched: 0, stillPending: pending.length };
  }

  const candidates: MatchCandidate[] = companies.map((company) => ({
    companyId: company.id,
    name: company.name,
    website: company.website,
    contactEmails: company.contacts
      .map((contact) => contact.email)
      .filter((email): email is string => !!email),
  }));
  const named = companies.map((company) => ({ companyId: company.id, name: company.name }));

  let matched = 0;

  for (const update of pending) {
    // Sender first, then what the email says. The second is what catches the
    // third-party senders: a bank confirming a wire to "Viaka Pintours 2026,
    // LLC", or a DocuSign envelope named after the company.
    const bySender = matchCompany(
      { fromAddress: update.fromAddress, subject: update.subject },
      candidates,
    );
    const match =
      bySender ?? matchCompanyByContent(update.rawText, named, { subject: update.subject });

    if (!match || match.confidence < AUTO_MATCH_THRESHOLD) continue;

    await prisma.update.update({
      where: { id: update.id },
      data: { companyId: match.companyId, reviewState: "CONFIRMED", matchConfidence: match.confidence },
    });
    matched += 1;
  }

  return { considered: pending.length, matched, stillPending: pending.length - matched };
}
