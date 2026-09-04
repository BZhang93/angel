import "server-only";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { extractStructured } from "@/lib/ai/client";
import {
  isProfileSourceKind,
  pickProfileSource,
  PROFILE_SOURCE_PRIORITY,
  sourceFraming,
} from "./profile-source";

// Profile polish from whatever was fetched about a company.
//
// Modest by design: what the company does, its sector and stage signals. Same
// rule as everywhere else in this app, it may fill a gap but never overwrite
// something already recorded.
//
// Websites were the only source read here for a long time, which left a company
// reading "Unspecified" while an investment memo about it sat fetched and
// stored. Memos and call transcripts are read too now, in that order of
// preference, since a memo states a sector more plainly than a homepage does.

const ProfileSchema = z.object({
  description: z
    .string()
    .nullable()
    .describe("One sentence on what the company actually does, in plain language, no marketing."),
  sector: z.string().nullable().describe("Two or three words, e.g. 'Developer tools'."),
  hqCountry: z.string().nullable(),
});

function systemFor(kind: Parameters<typeof sourceFraming>[0]): string {
  const framing = sourceFraming(kind);
  return `You are reading ${framing.noun} to summarise the company for an angel investor's records.

- description: one plain sentence on what the company does. ${framing.caution}
- sector: two or three words.
- hqCountry: only if the text states it.
- Null is the right answer for anything the text does not say.`;
}

export interface EnrichResult {
  enriched: number;
}

/// Reads the best fetched document for each company that still has gaps.
export async function enrichCompanyProfiles(
  userId: string,
  opts: { companyId?: string; limit?: number } = {},
): Promise<EnrichResult> {
  const pending = await prisma.document.findMany({
    where: {
      userId,
      kind: { in: PROFILE_SOURCE_PRIORITY },
      textContent: { not: null },
      extractedAt: null,
      ...(opts.companyId ? { companyId: opts.companyId } : {}),
    },
    include: { company: true },
    // Oldest first, so a tie between two memos goes to the one written when the
    // deal was announced.
    orderBy: { createdAt: "asc" },
  });

  // One document per company, best kind wins. Reading all of them would spend a
  // model call on a transcript to fill fields the memo just filled.
  const byCompany = new Map<string, typeof pending>();
  for (const document of pending) {
    if (!document.companyId) continue;
    byCompany.set(document.companyId, [...(byCompany.get(document.companyId) ?? []), document]);
  }

  const documents = [...byCompany.values()]
    .map((group) => pickProfileSource(group))
    .filter((document): document is (typeof pending)[number] => document != null)
    .slice(0, opts.limit ?? 10);

  let enriched = 0;

  for (const document of documents) {
    if (!document.company || !isProfileSourceKind(document.kind)) continue;

    // Nothing to gain: every field this could fill is already set.
    const company = document.company;
    if (company.description && company.sector && company.hqCountry) {
      await prisma.document.update({
        where: { id: document.id },
        data: { extractedAt: new Date() },
      });
      continue;
    }

    try {
      const profile = await extractStructured(
        systemFor(document.kind),
        `Company: ${company.name}\n\n${sourceFraming(document.kind).label}:\n${document.textContent!.slice(0, 20_000)}`,
        ProfileSchema,
        { effort: "low" },
      );

      await prisma.company.update({
        where: { id: company.id },
        data: {
          description: company.description ?? profile.description,
          sector: company.sector ?? profile.sector,
          hqCountry: company.hqCountry ?? profile.hqCountry,
        },
      });
      await prisma.document.update({
        where: { id: document.id },
        data: { extractedAt: new Date(), summary: profile.description },
      });
      enriched += 1;
    } catch {
      // Leave extractedAt null so it is retried on the next run.
    }
  }

  return { enriched };
}
