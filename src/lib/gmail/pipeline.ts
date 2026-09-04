import "server-only";
import { prisma } from "@/lib/prisma";
import { decryptSecret } from "@/lib/crypto";
import { accessTokenFromRefresh, watchMailbox } from "./client";
import { syncGmail } from "./sync";
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
  filed: number;
  extracted: number;
  documents: number;
  /// Fees taken from a syndicate's wire instructions, which state them long
  /// before a bank transfer reveals them.
  fees: number;
  pending: number;
}

export async function runIngestPipeline(userId: string): Promise<PipelineResult> {
  const sync = await syncGmail(userId);
  const rematch = await rematchPendingUpdates(userId);
  await fetchPendingLinks(userId);
  const extraction = await extractPendingUpdates(userId, extractFromUpdate, { limit: 60 });
  const documents = await extractPendingDocuments(userId);
  // After extraction, so a wire table read here is compared against the
  // commitment the same sync just filed rather than an empty position.
  const wireFees = await recordWireInstructionFees(userId);
  await enrichCompanyProfiles(userId);

  return {
    created: sync.created,
    filed: rematch.matched,
    extracted: extraction.extracted,
    documents: documents.extracted,
    fees: wireFees.feesRecorded,
    pending: rematch.stillPending,
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
