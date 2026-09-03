import "server-only";
import { prisma } from "@/lib/prisma";
import { ProposalSchema, type Proposal } from "./schema";

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
  const result = ProposalSchema.safeParse(payload);
  return result.success ? result.data : null;
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

  const website =
    overrides.website !== undefined
      ? overrides.website
      : (proposal.website ?? `https://${candidate.sourceDomain}`);
  const sector = overrides.sector !== undefined ? overrides.sector : proposal.sector;

  const companyId = await prisma.$transaction(async (tx) => {
    const company = await tx.company.upsert({
      where: { userId_name: { userId, name } },
      create: {
        userId,
        name,
        website,
        sector,
        description: proposal.description,
        stage: proposal.stage,
        status: "ACTIVE",
        sourcedBy: "Gmail import",
      },
      update: {},
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
    }

    await tx.importCandidate.update({
      where: { id: candidate.id },
      data: { state: "IMPORTED", companyId: company.id },
    });

    return company.id;
  });

  return { companyId };
}
