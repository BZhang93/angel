import "server-only";
import { prisma } from "@/lib/prisma";
import { decryptSecret } from "@/lib/crypto";
import { accessTokenFromRefresh, watchMailbox } from "./client";
import { syncGmail } from "./sync";
import { discoverUpdates } from "./discover";
import { scanCompanyUpdates } from "./refresh";
import { rematchPendingUpdates } from "./rematch";
import { recordWireInstructionFees } from "@/lib/import/wire-fees";
import { fetchPendingLinks } from "@/lib/enrich/links";
import { enrichCompanyProfiles } from "@/lib/enrich/company";
import { extractPendingUpdates } from "@/lib/extract/apply";
import { extractPendingDocuments } from "@/lib/extract/apply-document";
import { extractFromUpdate } from "@/lib/extract/update";

// The whole ingest pipeline in one call, so a button, a cron and a push
// notification all do exactly the same thing rather than three similar things
// that drift apart.

export interface PipelineResult {
  created: number;
  /// Of `created`, how many came from mail the user never labelled: the
  /// company scan plus discovery. Reported separately because this is the half
  /// the user did no work for, and the half worth checking.
  unlabelled: number;
  /// Discovered mail the gate refused, so nothing about it was stored or read.
  refused: number;
  /// False while discovery still has older mail to walk back through, so a
  /// first sync on a large mailbox can say that it is not finished yet.
  backfilled: boolean;
  filed: number;
  extracted: number;
  documents: number;
  /// Fees taken from a syndicate's wire instructions, which state them long
  /// before a bank transfer reveals them.
  fees: number;
  pending: number;
  /// Why extraction failed, when it did. A run that reads nothing because a
  /// credential expired must not look like a run with nothing to read.
  extractionError?: string;
}

export async function runIngestPipeline(
  userId: string,
  /// `deep` runs the two mailbox-wide sweeps: the company scan and discovery.
  /// A push notification fires once per incoming email, so it passes false and
  /// reads just that mail. Running a 365-day sweep per arriving email multiplies
  /// Gmail quota and makes overlapping runs collide on the message-id unique.
  opts: { deep?: boolean } = {},
): Promise<PipelineResult> {
  const account = await prisma.gmailAccount.findUnique({ where: { userId } });
  if (!account) throw new Error("Connect Gmail first.");

  // Three ways in, narrowest first, each deduplicating on the Gmail message id
  // so an email found twice is stored once.
  //
  //   1. the user's own label, when they keep one.
  //   2. the portfolio's own senders, which is certain by construction.
  //   3. discovery, for everything never filed, gated deterministically.
  //
  // The order is what keeps the certain reading: a company scan files an email
  // against the company whose domain sent it, so discovery finds nothing left
  // to guess about.
  const sync = account.syncQuery.trim()
    ? await syncGmail(userId)
    : { created: 0, autoMatched: 0, documents: 0 };
  const deep = opts.deep ?? true;
  const scan = deep ? await scanCompanyUpdates(userId) : { created: 0, documents: 0 };
  const discovery =
    deep && account.autoDiscover
      ? await discoverUpdates(userId, { sinceDays: account.discoverDays })
      : { created: 0, refused: 0, documents: 0, backfilled: true };

  const rematch = await rematchPendingUpdates(userId);
  await fetchPendingLinks(userId);
  const extraction = await extractPendingUpdates(userId, extractFromUpdate, { limit: 60 });
  const documents = await extractPendingDocuments(userId);
  // After extraction, so a wire table read here is compared against the
  // commitment the same sync just filed rather than an empty position.
  const wireFees = await recordWireInstructionFees(userId);
  await enrichCompanyProfiles(userId);

  // Every path through this function has now read the mailbox, so every path
  // records it. Only syncGmail used to, and an empty query skips syncGmail, so
  // Settings reported "Last synced never" forever to exactly the users the new
  // copy invites to leave the query empty.
  await prisma.gmailAccount.update({
    where: { userId },
    data: { lastSyncedAt: new Date() },
  });

  return {
    created: sync.created + scan.created + discovery.created,
    unlabelled: scan.created + discovery.created,
    refused: discovery.refused,
    filed: rematch.matched,
    extracted: extraction.extracted,
    documents: documents.extracted,
    fees: wireFees.feesRecorded,
    pending: rematch.stillPending,
    backfilled: discovery.backfilled,
    ...(extraction.failureReason ? { extractionError: extraction.failureReason } : {}),
  };
}

/// Registers or renews the Gmail push subscription, when a Pub/Sub topic is
/// configured. Without one, auto-sync falls back to the scheduled poll, which
/// is the only option in local development anyway: Google cannot push to a
/// laptop.
export async function ensureWatch(userId: string): Promise<{ watching: boolean; reason?: string }> {
  const topic = process.env.GOOGLE_PUBSUB_TOPIC;
  if (!topic) return { watching: false, reason: "No Pub/Sub topic configured; polling instead." };

  const account = await prisma.gmailAccount.findUnique({ where: { userId } });
  if (!account?.autoSync) return { watching: false, reason: "Auto-sync is off." };

  // Renew a day early: a lapsed watch stops delivering with no error anywhere.
  const renewAt = account.watchExpiresAt
    ? account.watchExpiresAt.getTime() - 24 * 60 * 60 * 1000
    : 0;
  if (Date.now() < renewAt) return { watching: true };

  const accessToken = await accessTokenFromRefresh(decryptSecret(account.refreshTokenEncrypted));
  const watch = await watchMailbox(accessToken, topic);

  await prisma.gmailAccount.update({
    where: { userId },
    data: {
      watchExpiresAt: watch.expiration,
      lastHistoryId: watch.historyId || account.lastHistoryId,
    },
  });
  return { watching: true };
}
