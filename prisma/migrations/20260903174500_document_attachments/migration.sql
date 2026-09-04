-- Documents become first-class email attachments: metadata is recorded on
-- ingest and the bytes are fetched afterwards, so a failed download still
-- leaves a record that a signed SAFE exists.
ALTER TABLE "Document" ALTER COLUMN "storagePath" DROP NOT NULL;
ALTER TABLE "Document" ADD COLUMN "updateId" TEXT;
ALTER TABLE "Document" ADD COLUMN "gmailMessageId" TEXT;
ALTER TABLE "Document" ADD COLUMN "gmailAttachmentId" TEXT;
ALTER TABLE "Document" ADD COLUMN "extractedAt" TIMESTAMP(3);
ALTER TABLE "Document" ADD COLUMN "summary" TEXT;

ALTER TABLE "Document" ADD CONSTRAINT "Document_updateId_fkey"
  FOREIGN KEY ("updateId") REFERENCES "Update"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE UNIQUE INDEX "Document_userId_gmailMessageId_gmailAttachmentId_key"
  ON "Document"("userId", "gmailMessageId", "gmailAttachmentId");
CREATE INDEX "Document_updateId_idx" ON "Document"("updateId");
