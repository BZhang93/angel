import "server-only";
import { prisma } from "@/lib/prisma";
import { decryptSecret } from "@/lib/crypto";
import { accessTokenFromRefresh, getMessage } from "./client";
import { ingestAttachments } from "./attachments";

// Fetching attachments for mail that was stored without them.
//
// The import scan stores every message it reads so that an accepted company
// arrives with its history, and it skips attachments to stay fast, with a
// comment promising they are "left to the next sync". No sync ever collects:
// ingest deduplicates on the Gmail message id and skips a stored message
// forever, so the promise had nothing behind it. Every signed agreement that
// first arrived through an import scan was dropped on the floor.
//
// This is that collection. Gmail only, no model calls, and bounded per run so
// a first pass over a large mailbox is spread across several syncs rather than
// one that times out.

export interface BackfillResult {
  examined: number;
  recorded: number;
  stored: number;
  failed: number;
  /// True when nothing is left to check and nothing is missing its bytes, so
  /// a caller can stop reporting it.
  complete: boolean;
}

const DEFAULT_LIMIT = 120;

export async function backfillAttachments(
  userId: string,
  opts: { limit?: number } = {},
): Promise<BackfillResult> {
  const limit = opts.limit ?? DEFAULT_LIMIT;
  const account = await prisma.gmailAccount.findUnique({ where: { userId } });
  if (!account) throw new Error("Connect Gmail first.");

  const pending = await prisma.update.findMany({
    where: {
      userId,
      OR: [
        { attachmentsCheckedAt: null },
        // Checked, but an attachment it found has no bytes: the download or
        // the upload failed, which happens for a whole run at a time when
        // storage is misconfigured. Without this the stamp would make a
        // transient outage permanent, since the row looks dealt with.
        { documents: { some: { storagePath: null, gmailAttachmentId: { not: null } } } },
      ],
    },
    // Newest first: a recently signed agreement is the one someone is waiting
    // on, and an old one has waited this long already.
    orderBy: { receivedAt: "desc" },
    take: limit,
    select: { id: true, gmailMessageId: true, companyId: true },
  });

  const result: BackfillResult = {
    examined: 0,
    recorded: 0,
    stored: 0,
    failed: 0,
    complete: pending.length < limit,
  };
  if (pending.length === 0) return result;

  const accessToken = await accessTokenFromRefresh(decryptSecret(account.refreshTokenEncrypted));

  for (const update of pending) {
    let email;
    try {
      email = await getMessage(accessToken, update.gmailMessageId);
    } catch {
      // Left unstamped so the next run tries again: a message that cannot be
      // read today may be readable tomorrow, and the alternative is deciding
      // it has no attachments on no evidence.
      result.failed += 1;
      continue;
    }
    result.examined += 1;

    if (email.attachments.length > 0) {
      const ingested = await ingestAttachments(userId, {
        accessToken,
        updateId: update.id,
        companyId: update.companyId,
        gmailMessageId: update.gmailMessageId,
        attachments: email.attachments,
      });
      result.recorded += ingested.recorded;
      result.stored += ingested.stored;
      result.failed += ingested.failed;
    }

    // Stamped whether or not anything was found. "Checked and there was
    // nothing" is the answer for most mail, and recording it is what stops
    // every run re-reading the whole mailbox.
    await prisma.update.update({
      where: { id: update.id },
      data: { attachmentsCheckedAt: new Date() },
    });
  }

  return result;
}
