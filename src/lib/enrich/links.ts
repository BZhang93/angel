import "server-only";
import { prisma } from "@/lib/prisma";
import { domainOfWebsite } from "@/lib/import/identity";
import {
  classifyLink,
  fetchableUrl,
  isTooThin,
  isWorthFetching,
  type FetchableKind,
} from "./classify";
import { fetchPage } from "./fetch";

// Fetching the links worth reading out of stored updates.
//
// Memos and call recordings are the substance here: an ungated share link often
// holds the transcript of the diligence call, or the memo the syndicate wrote.
// The company's own site is fetched once for profile polish. Everything else is
// left alone, on purpose (see ./classify.ts).

export interface LinkFetchResult {
  considered: number;
  fetched: number;
  skipped: number;
  failed: number;
}

const DOCUMENT_KIND: Record<FetchableKind, "MEMO" | "RECORDING" | "WEBSITE"> = {
  MEMO: "MEMO",
  RECORDING: "RECORDING",
  WEBSITE: "WEBSITE",
};

export async function fetchPendingLinks(
  userId: string,
  opts: { limit?: number; companyId?: string } = {},
): Promise<LinkFetchResult> {
  const updates = await prisma.update.findMany({
    where: {
      userId,
      reviewState: "CONFIRMED",
      companyId: opts.companyId ?? { not: null },
    },
    include: { company: { select: { id: true, name: true, website: true } } },
    orderBy: { receivedAt: "desc" },
    take: opts.limit ?? 40,
  });

  // Already-fetched URLs, so a memo linked from every monthly update is read
  // once rather than every time.
  const known = new Set(
    (
      await prisma.document.findMany({
        where: { userId, sourceUrl: { not: null } },
        select: { sourceUrl: true },
      })
    ).map((row) => row.sourceUrl!),
  );

  let considered = 0;
  let fetched = 0;
  let skipped = 0;
  let failed = 0;

  for (const update of updates) {
    const companyDomain = domainOfWebsite(update.company?.website);

    for (const url of update.links) {
      const kind = classifyLink(url, { companyDomain });
      if (!isWorthFetching(kind)) continue;

      considered += 1;
      if (known.has(url)) continue;
      known.add(url);

      // One website page per company is enough: the homepage tells you what
      // they do, and every subsequent blog post costs a fetch to say the same.
      if (kind === "WEBSITE") {
        const existing = await prisma.document.findFirst({
          where: { userId, companyId: update.companyId, kind: "WEBSITE" },
        });
        if (existing) continue;
      }

      try {
        // Fetched at whatever URL actually serves the text; stored against the
        // link the email contained.
        const page = await fetchPage(fetchableUrl(url));
        if (isTooThin(page.text)) {
          skipped += 1;
          continue;
        }

        await prisma.document.upsert({
          where: { userId_sourceUrl: { userId, sourceUrl: url } },
          create: {
            userId,
            companyId: update.companyId,
            updateId: update.id,
            kind: DOCUMENT_KIND[kind],
            title: page.title ?? url,
            sourceUrl: url,
            textContent: page.text,
            mimeType: "text/html",
            sizeBytes: page.text.length,
            fetchedAt: new Date(),
          },
          update: { textContent: page.text, fetchedAt: new Date() },
        });
        fetched += 1;
      } catch {
        // A dead link, a login wall behind a redirect, or a host that refuses
        // us. Not worth surfacing: the link is still on the update.
        failed += 1;
      }
    }
  }

  return { considered, fetched, skipped, failed };
}

/// The text of memos and transcripts attached to an update, for the extractor
/// to read alongside the email body.
export async function linkedTextForUpdate(updateId: string): Promise<string[]> {
  const documents = await prisma.document.findMany({
    where: { updateId, textContent: { not: null }, kind: { in: ["MEMO", "RECORDING"] } },
    select: { title: true, kind: true, textContent: true },
  });

  return documents.map(
    (document) =>
      `--- ${document.kind === "RECORDING" ? "Call recording / transcript" : "Linked memo"}: ${document.title} ---\n${document.textContent}`,
  );
}
