-- One import candidate per company rather than per sender.
--
-- Keying by sender produced four cards for one deal: the syndicate announcing
-- it, the investor's reply, the bank's wire and the DocuSign envelope. The
-- canonical name collapses those, and the senders that described it are kept.
ALTER TABLE "ImportCandidate" ADD COLUMN "canonicalName" TEXT;
ALTER TABLE "ImportCandidate" ADD COLUMN "sourceDomains" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- Existing rows have no canonical name and are proposals from the old scheme;
-- they are cleared rather than guessed at, and the next scan rebuilds them.
DELETE FROM "ImportCandidate" WHERE state = 'PROPOSED';
UPDATE "ImportCandidate" SET "canonicalName" = lower("proposedName") WHERE "canonicalName" IS NULL;
ALTER TABLE "ImportCandidate" ALTER COLUMN "canonicalName" SET NOT NULL;

DROP INDEX IF EXISTS "ImportCandidate_userId_sourceDomain_proposedName_key";
CREATE UNIQUE INDEX "ImportCandidate_userId_canonicalName_key"
  ON "ImportCandidate"("userId", "canonicalName");
