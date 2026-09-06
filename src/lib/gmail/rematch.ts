import "server-only";
import { prisma } from "@/lib/prisma";
import {
  AUTO_MATCH_THRESHOLD,
  bestMatch,
  matchCompany,
  SUGGESTION_THRESHOLD,
  type MatchCandidate,
} from "./match";
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
  /// Left pending, but now carrying the company they probably belong to.
  suggested: number;
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
    return { considered: pending.length, matched: 0, suggested: 0, stillPending: pending.length };
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
  let suggested = 0;

  for (const update of pending) {
    // Both readings, then the stronger one. Not the first that answers: the
    // sender rule returns a weak 0.6 for a company name in the subject, which
    // used to suppress the content match outright.
    const match = bestMatch(
      matchCompany({ fromAddress: update.fromAddress, subject: update.subject }, candidates),
      matchCompanyByContent(update.rawText, named, { subject: update.subject }),
    );

    if (!match) continue;

    // Too weak to file, strong enough to point at. Recording it leaves the
    // update in the queue but gives the reviewer a suggestion to accept, and
    // gives the queue something to group by. Discarding it, as this used to,
    // meant every pending row arrived blank and the confidence pill the page
    // renders never had anything to show.
    if (match.confidence < AUTO_MATCH_THRESHOLD) {
      if (match.confidence < SUGGESTION_THRESHOLD) continue;
      await prisma.update.update({
        where: { id: update.id },
        data: { companyId: match.companyId, matchConfidence: match.confidence },
      });
      suggested += 1;
      continue;
    }

    await prisma.update.update({
      where: { id: update.id },
      data: { companyId: match.companyId, reviewState: "CONFIRMED", matchConfidence: match.confidence },
    });
    matched += 1;
  }

  return { considered: pending.length, matched, suggested, stillPending: pending.length - matched };
}
