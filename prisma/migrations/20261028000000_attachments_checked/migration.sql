ALTER TABLE "Update" ADD COLUMN "attachmentsCheckedAt" TIMESTAMP(3);

-- Rows whose attachments were already ingested at the moment they were stored
-- are marked checked, so the backfill only pays for mail nobody has looked at.
UPDATE "Update" u
SET "attachmentsCheckedAt" = u."createdAt"
WHERE EXISTS (
  SELECT 1 FROM "Document" d
  WHERE d."gmailMessageId" = u."gmailMessageId" AND d."userId" = u."userId"
);
