ALTER TABLE "Document" ADD COLUMN "sourceUrl" TEXT;
ALTER TABLE "Document" ADD COLUMN "textContent" TEXT;
ALTER TABLE "Document" ADD COLUMN "fetchedAt" TIMESTAMP(3);

-- A memo linked from five updates is one document, fetched once.
CREATE UNIQUE INDEX "Document_userId_sourceUrl_key" ON "Document"("userId", "sourceUrl");
