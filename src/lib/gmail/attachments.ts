import "server-only";
import { prisma } from "@/lib/prisma";
import { attachmentPath, uploadAttachment } from "@/lib/storage";
import { getAttachment } from "./client";
import {
  guessDocumentKind,
  isDocumentAttachment,
  isWorthReading,
  type EmailAttachment,
} from "./parse";
import type { DocumentKind } from "@/generated/prisma/enums";

// Recording and fetching email attachments.
//
// Metadata first, bytes second. Knowing a signed SAFE exists is valuable on its
// own, and survives a storage outage or a quota stall, so the Document row is
// written before anything is downloaded.

export interface IngestResult {
  recorded: number;
  stored: number;
  failed: number;
}

export async function ingestAttachments(
  userId: string,
  input: {
    accessToken: string;
    updateId: string;
    companyId: string | null;
    gmailMessageId: string;
    attachments: EmailAttachment[];
  },
): Promise<IngestResult> {
  let recorded = 0;
  let stored = 0;
  let failed = 0;

  for (const attachment of input.attachments) {
    // Skipped before the row exists, not before the download. A logo recorded
    // as a document is clutter in every documents list for ever, and unlike a
    // skipped download it leaves nothing useful behind.
    if (!isDocumentAttachment(attachment)) continue;

    const existing = await prisma.document.findUnique({
      where: {
        userId_gmailMessageId_gmailAttachmentId: {
          userId,
          gmailMessageId: input.gmailMessageId,
          gmailAttachmentId: attachment.attachmentId,
        },
      },
    });
    if (existing?.storagePath) continue;

    const document =
      existing ??
      (await prisma.document.create({
        data: {
          userId,
          companyId: input.companyId,
          updateId: input.updateId,
          kind: guessDocumentKind(attachment.filename) as DocumentKind,
          title: attachment.filename,
          mimeType: attachment.mimeType,
          sizeBytes: attachment.sizeBytes,
          gmailMessageId: input.gmailMessageId,
          gmailAttachmentId: attachment.attachmentId,
        },
      }));
    recorded += 1;

    // Only documents worth reading are downloaded. A 30MB deck is noise with a
    // storage bill attached; the row still records that it arrived.
    if (!isWorthReading(attachment)) continue;

    try {
      const bytes = await getAttachment(
        input.accessToken,
        input.gmailMessageId,
        attachment.attachmentId,
      );
      const path = attachmentPath(
        userId,
        input.gmailMessageId,
        attachment.attachmentId,
        attachment.filename,
      );
      await uploadAttachment(path, bytes, attachment.mimeType);
      await prisma.document.update({
        where: { id: document.id },
        data: { storagePath: path, sizeBytes: bytes.byteLength },
      });
      stored += 1;
    } catch {
      // The metadata row stays, so a later run retries exactly this document.
      failed += 1;
    }
  }

  return { recorded, stored, failed };
}
