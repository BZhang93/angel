import "server-only";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { extractStructured } from "@/lib/ai/client";

// Profile polish from a company's own website.
//
// Modest by design: what the company does, its sector and stage signals. Same
// rule as everywhere else in this app, it may fill a gap but never overwrite
// something already recorded.

const ProfileSchema = z.object({
  description: z
    .string()
    .nullable()
    .describe("One sentence on what the company actually does, in plain language, no marketing."),
  sector: z.string().nullable().describe("Two or three words, e.g. 'Developer tools'."),
  hqCountry: z.string().nullable(),
});

const SYSTEM = `You are reading a startup's own website to summarise it for an angel investor's records.

- description: one plain sentence on what the company does. Strip the marketing voice: "AI-powered platform revolutionising X" becomes what it actually is.
- sector: two or three words.
- hqCountry: only if the page states it.
- Null is the right answer for anything the page does not say.`;

export interface EnrichResult {
  enriched: number;
}

/// Reads any fetched WEBSITE document whose company still has gaps.
export async function enrichCompanyProfiles(
  userId: string,
  opts: { companyId?: string; limit?: number } = {},
): Promise<EnrichResult> {
  const documents = await prisma.document.findMany({
    where: {
      userId,
      kind: "WEBSITE",
      textContent: { not: null },
      extractedAt: null,
      ...(opts.companyId ? { companyId: opts.companyId } : {}),
    },
    include: { company: true },
    take: opts.limit ?? 10,
  });

  let enriched = 0;

  for (const document of documents) {
    if (!document.company) continue;

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
        SYSTEM,
        `Company: ${company.name}\n\nWebsite text:\n${document.textContent!.slice(0, 20_000)}`,
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
