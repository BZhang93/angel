-- DocuSign as a document source in its own right: the signed envelope is the
-- authoritative copy of an instrument's terms, whether or not the completion
-- email happened to carry the PDF.
CREATE TABLE "DocusignAccount" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "accountName" TEXT,
  "baseUri" TEXT NOT NULL,
  "refreshTokenEncrypted" TEXT NOT NULL,
  "lastSyncedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DocusignAccount_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DocusignAccount_userId_key" ON "DocusignAccount"("userId");

ALTER TABLE "DocusignAccount" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "DocusignAccount" FROM anon, authenticated;

ALTER TABLE "Document" ADD COLUMN "docusignEnvelopeId" TEXT;
CREATE UNIQUE INDEX "Document_userId_docusignEnvelopeId_key"
  ON "Document"("userId", "docusignEnvelopeId");
