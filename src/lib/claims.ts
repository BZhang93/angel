import "server-only";
import { prisma } from "@/lib/prisma";
import type { ClaimKind, ClaimSource } from "@/generated/prisma/enums";

// Recording what each source says. Every writer that learns an amount records
// its claim here as well as writing the ledger, so a disagreement can name the
// source rather than just the number.

export async function recordClaim(input: {
  userId: string;
  companyId: string;
  positionId: string | null;
  source: ClaimSource;
  kind: ClaimKind;
  amount: number;
  sourceQuote?: string | null;
  updateId?: string | null;
  documentId?: string | null;
  paymentId?: string | null;
}): Promise<void> {
  if (!Number.isFinite(input.amount) || input.amount <= 0) return;

  // A re-read replaces the same source's previous claim rather than piling up.
  // Without a position there is nothing to compare against, so the claim is
  // still kept but cannot be deduplicated by the unique key.
  if (!input.positionId) {
    await prisma.amountClaim.create({
      data: {
        userId: input.userId,
        companyId: input.companyId,
        positionId: null,
        source: input.source,
        kind: input.kind,
        amount: input.amount,
        sourceQuote: input.sourceQuote ?? null,
        updateId: input.updateId ?? null,
        documentId: input.documentId ?? null,
        paymentId: input.paymentId ?? null,
      },
    });
    return;
  }

  await prisma.amountClaim.upsert({
    where: {
      userId_positionId_source_kind: {
        userId: input.userId,
        positionId: input.positionId,
        source: input.source,
        kind: input.kind,
      },
    },
    create: {
      userId: input.userId,
      companyId: input.companyId,
      positionId: input.positionId,
      source: input.source,
      kind: input.kind,
      amount: input.amount,
      sourceQuote: input.sourceQuote ?? null,
      updateId: input.updateId ?? null,
      documentId: input.documentId ?? null,
      paymentId: input.paymentId ?? null,
    },
    update: {
      amount: input.amount,
      sourceQuote: input.sourceQuote ?? null,
      updateId: input.updateId ?? null,
      documentId: input.documentId ?? null,
      paymentId: input.paymentId ?? null,
    },
  });
}

/// Claims made without a position, attached once one exists. A bank transfer
/// often arrives before anything is recorded to attach it to.
export async function attachOrphanClaims(
  userId: string,
  companyId: string,
  positionId: string,
): Promise<void> {
  await prisma.amountClaim.updateMany({
    where: { userId, companyId, positionId: null },
    data: { positionId },
  });
}
