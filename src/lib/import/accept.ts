import "server-only";
import { prisma } from "@/lib/prisma";
import { CompanyProposalSchema, type Proposal } from "./schema";
import { findExistingCompany, domainOfWebsite } from "./identity";
import { isCompanyDomain } from "./domains";

// Turning an accepted proposal into portfolio rows. Kept separate from the scan
// so accepting never depends on the LLM, and so the write path is one place.

function parseDate(value: string | null): Date | null {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

/// Re-validates the stored payload before writing: the JSON column is only as
/// trustworthy as the run that produced it, and schemas change.
export function parseProposal(payload: unknown): Proposal | null {
  const result = CompanyProposalSchema.safeParse(payload);
  return result.success ? result.data : null;
}

/// What accepting this candidate will do, for the review screen: joining an
/// existing company or creating a new one.
export async function previewAccept(
  userId: string,
  input: { name: string; website: string | null },
): Promise<{ mergesInto: string; reason: string } | null> {
  const existing = await prisma.company.findMany({
    where: { userId },
    select: { id: true, name: true, website: true },
  });
  const match = findExistingCompany(input, existing);
  if (!match) return null;
  return {
    mergesInto: match.company.name,
    reason: match.reason === "domain" ? "same company website" : "same name",
  };
}

export interface AcceptOverrides {
  name?: string;
  website?: string | null;
  sector?: string | null;
}

/// Creates the company, its positions and their opening transactions, then
/// marks the candidate imported. Idempotent on company name: accepting twice
/// adds positions to the existing company rather than creating a duplicate.
export async function acceptCandidate(
  userId: string,
  candidateId: string,
  overrides: AcceptOverrides = {},
): Promise<{ companyId: string } | { error: string }> {
  const candidate = await prisma.importCandidate.findFirst({
    where: { id: candidateId, userId },
  });
  if (!candidate) return { error: "Candidate not found." };
  if (candidate.state === "IMPORTED") return { error: "Already imported." };

  const proposal = parseProposal(candidate.payload);
  if (!proposal) return { error: "This proposal is no longer readable. Rescan to rebuild it." };

  const name = (overrides.name ?? proposal.name ?? candidate.proposedName).trim();
  if (!name) return { error: "A company name is required." };

  // Only a plausible company site is kept. The sender's domain is never it: a
  // Viaka or Bank of America address describes how the mail arrived, not who
  // the company is.
  const proposedWebsite = overrides.website !== undefined ? overrides.website : proposal.website;
  const website = isCompanyDomain(domainOfWebsite(proposedWebsite)) ? proposedWebsite : null;
  const sector = overrides.sector !== undefined ? overrides.sector : proposal.sector;

  // Consolidate rather than duplicate. The same business arrives twice often
  // enough to matter: directly and through a syndicate, or as "Bravi" one month
  // and "Bravi Inc." the next. A match adds positions to the company that
  // already exists; only a genuinely new name creates one.
  const existing = await prisma.company.findMany({
    where: { userId },
    select: { id: true, name: true, website: true },
  });
  const match = findExistingCompany({ name, website }, existing);

  const companyId = await prisma.$transaction(async (tx) => {
    const company = match
      ? await tx.company.update({
          where: { id: match.company.id },
          // Fill gaps on the existing record, never overwrite what is there.
          data: {
            website: match.company.website ?? website,
            sector: sector ?? undefined,
            description: proposal.description ?? undefined,
          },
        })
      : await tx.company.create({
          data: {
            userId,
            name,
            website,
            sector,
            description: proposal.description,
            stage: proposal.stage,
            status: "ACTIVE",
            sourcedBy: "Gmail import",
            notes: proposal.notes ? `Import note: ${proposal.notes}` : null,
          },
        });

    if (proposal.contactEmail) {
      const existing = await tx.contact.findFirst({
        where: { companyId: company.id, email: proposal.contactEmail },
      });
      if (!existing) {
        await tx.contact.create({
          data: {
            companyId: company.id,
            name: proposal.contactName ?? proposal.contactEmail,
            email: proposal.contactEmail,
          },
        });
      }
    }

    for (const proposedPosition of proposal.positions) {
      // A position with no date cannot drive the QSBS or IRR clocks, so it is
      // not written. The company still imports, and the reviewer adds the
      // cheque by hand: better a visible gap than a fabricated date.
      const investmentDate = parseDate(proposedPosition.investmentDate);
      if (!investmentDate) continue;

      const position = await tx.position.create({
        data: {
          userId,
          companyId: company.id,
          instrumentType: proposedPosition.instrumentType,
          investmentGroup: proposal.investmentGroup,
          investmentDate,
          valuationCap: proposedPosition.valuationCap,
          discountPct: proposedPosition.discountPct,
          safeIsPostMoney: proposedPosition.safeIsPostMoney,
          interestRatePct: proposedPosition.interestRatePct,
          maturityDate: parseDate(proposedPosition.maturityDate),
          hasProRata: proposedPosition.hasProRata ?? false,
          notes: `Imported from ${candidate.sourceDomain}: "${proposedPosition.sourceQuote}"`,
        },
      });

      if (proposedPosition.amount != null && proposedPosition.amount > 0) {
        await tx.transaction.create({
          data: {
            userId,
            positionId: position.id,
            kind: "INVESTMENT",
            amount: proposedPosition.amount,
            date: investmentDate,
          },
        });
      }

      // Fees buy no ownership, so they go in the ledger as their own line and
      // drag the return, which is the honest treatment.
      if (proposedPosition.feesAmount != null && proposedPosition.feesAmount > 0) {
        await tx.transaction.create({
          data: {
            userId,
            positionId: position.id,
            kind: "FEE",
            amount: proposedPosition.feesAmount,
            date: investmentDate,
            notes: "Imported: fees stated alongside the commitment.",
          },
        });
      }

      // A commitment with a wire deadline is not money out of the account. The
      // position is recorded either way, with a task to confirm it, because an
      // unsent wire is exactly the thing that goes missing.
      if (!proposedPosition.amountConfirmed) {
        await tx.actionItem.create({
          data: {
            userId,
            companyId: company.id,
            kind: "FOLLOW_UP",
            title: `Confirm the wire to ${name} was sent`,
            detail: `Imported as a commitment rather than a confirmed payment. Source: "${proposedPosition.sourceQuote}"`,
            dueDate: investmentDate,
          },
        });
      }
    }

    await tx.importCandidate.update({
      where: { id: candidate.id },
      data: { state: "IMPORTED", companyId: company.id },
    });

    return company.id;
  });

  return { companyId };
}
