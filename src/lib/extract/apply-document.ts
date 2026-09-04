import "server-only";
import { prisma } from "@/lib/prisma";
import { downloadAttachment } from "@/lib/storage";
import { extractDocumentTerms, type DocumentTerms } from "./document";
import { chooseTargetPosition, gapsOnly, parseIsoDate } from "./fill";

// Folding a document's terms into the portfolio.
//
// The rule that governs everything here lives in ./fill.ts, where it is unit
// tested: a document may fill a gap, never overwrite.

export interface DocumentExtractionResult {
  extracted: number;
  filled: number;
  failed: number;
}

/// Reads every stored, unextracted document and applies what it finds.
export async function extractPendingDocuments(
  userId: string,
  opts: { limit?: number } = {},
): Promise<DocumentExtractionResult> {
  const documents = await prisma.document.findMany({
    where: { userId, extractedAt: null, storagePath: { not: null } },
    include: { company: { select: { id: true, name: true } } },
    orderBy: { createdAt: "desc" },
    take: opts.limit ?? 20,
  });

  let extracted = 0;
  let filled = 0;
  let failed = 0;

  for (const document of documents) {
    let terms: DocumentTerms;
    try {
      const bytes = await downloadAttachment(document.storagePath!);
      terms = await extractDocumentTerms(bytes, {
        filename: document.title,
        companyName: document.company?.name,
        formFields: Array.isArray(document.formFields)
          ? (document.formFields as { name: string; value: string }[])
          : undefined,
      });
    } catch {
      failed += 1;
      continue;
    }

    await prisma.document.update({
      where: { id: document.id },
      data: {
        kind: terms.documentKind,
        summary: terms.summary,
        extractedAt: new Date(),
      },
    });
    extracted += 1;

    // An unsigned draft states terms that were never agreed, so it is recorded
    // and summarised but never allowed to touch a position.
    if (!terms.isExecuted || !document.companyId) continue;

    const positions = await prisma.position.findMany({
      where: { companyId: document.companyId, userId },
      select: {
        id: true,
        investmentDate: true,
        valuationCap: true,
        discountPct: true,
        safeIsPostMoney: true,
        interestRatePct: true,
        maturityDate: true,
        shareClass: true,
        shareCount: true,
        pricePerShare: true,
      },
    });

    const target = chooseTargetPosition(positions, terms);
    if (!target) continue;

    const patch = gapsOnly(target, {
      valuationCap: terms.valuationCap,
      discountPct: terms.discountPct,
      safeIsPostMoney: terms.safeIsPostMoney,
      interestRatePct: terms.interestRatePct,
      maturityDate: parseIsoDate(terms.maturityDate),
      shareClass: terms.shareClass,
      shareCount: terms.shareCount,
      pricePerShare: terms.pricePerShare,
    });

    if (Object.keys(patch).length > 0) {
      await prisma.position.update({ where: { id: target.id }, data: patch });
      filled += 1;
    }

    await prisma.document.update({
      where: { id: document.id },
      data: { positionId: target.id },
    });
  }

  return { extracted, filled, failed };
}
