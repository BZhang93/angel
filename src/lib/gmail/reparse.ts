import "server-only";
import { prisma } from "@/lib/prisma";
import { decryptSecret } from "@/lib/crypto";
import { accessTokenFromRefresh, getMessage } from "./client";

// Re-reading an email that is already stored.
//
// The sync cannot do this: it deduplicates on message id, so a row whose body
// was mangled at parse time stays mangled forever no matter how often the sync
// runs. That is how 21 forwarded updates sat empty across six companies. Gmail
// still holds the original, so the repair is a re-fetch and a re-parse.

export interface ReparseResult {
  read: number;
  rewritten: number;
  failed: number;
}

/// Re-fetches the given updates and rewrites the parsed fields. Only the fields
/// that come from parsing are touched: the company match, review state and
/// anything a human edited are left exactly as they are, because a body being
/// unreadable was never a reason to doubt who it was from.
export async function reparseUpdates(userId: string, updateIds: string[]): Promise<ReparseResult> {
  const account = await prisma.gmailAccount.findUnique({ where: { userId } });
  if (!account) throw new Error("Connect Gmail first.");

  const updates = await prisma.update.findMany({
    where: { userId, id: { in: updateIds } },
    select: { id: true, gmailMessageId: true, rawText: true },
  });

  const accessToken = await accessTokenFromRefresh(decryptSecret(account.refreshTokenEncrypted));

  let read = 0;
  let rewritten = 0;
  let failed = 0;

  for (const update of updates) {
    let email;
    try {
      email = await getMessage(accessToken, update.gmailMessageId);
    } catch {
      // A message the user has since deleted cannot be recovered, and the row
      // keeps its flag so it stays visible rather than silently looking fixed.
      failed += 1;
      continue;
    }
    read += 1;

    // Nothing gained means the parse was not the problem, so the flag stays.
    if (email.text.trim().length <= update.rawText.trim().length) continue;

    await prisma.update.update({
      where: { id: update.id },
      data: {
        rawText: email.text,
        links: email.links,
        // Cleared so the extraction pass can tell this apart from a row it has
        // already seen and found nothing in.
        ingestIssue: email.truncated ? "TRUNCATED_BODY" : null,
        // A recovered body has never been extracted, whatever the old row said.
        extractedAt: null,
        summary: null,
      },
    });
    rewritten += 1;
  }

  return { read, rewritten, failed };
}

/// Every update currently flagged as having lost its body.
export async function reparseTruncated(userId: string): Promise<ReparseResult> {
  const flagged = await prisma.update.findMany({
    where: { userId, ingestIssue: "TRUNCATED_BODY" },
    select: { id: true },
  });
  return reparseUpdates(
    userId,
    flagged.map((row) => row.id),
  );
}
