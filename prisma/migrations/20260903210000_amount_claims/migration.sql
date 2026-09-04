-- What each source says was invested. Kept apart so the app can name the source
-- that disagrees rather than showing one number and hoping it is right.
CREATE TYPE "ClaimSource" AS ENUM ('EMAIL_COMMITMENT', 'EMAIL_CONFIRMATION', 'BANK_TRANSFER', 'DOCUMENT', 'DOCUSIGN', 'MANUAL');
CREATE TYPE "ClaimKind" AS ENUM ('INVESTMENT', 'FEE', 'TOTAL');

CREATE TABLE "AmountClaim" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "positionId" TEXT,
  "source" "ClaimSource" NOT NULL,
  "kind" "ClaimKind" NOT NULL,
  "amount" DECIMAL(18,2) NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'USD',
  "sourceQuote" TEXT,
  "updateId" TEXT,
  "documentId" TEXT,
  "paymentId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AmountClaim_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AmountClaim_userId_positionId_source_kind_key"
  ON "AmountClaim"("userId", "positionId", "source", "kind");
CREATE INDEX "AmountClaim_companyId_idx" ON "AmountClaim"("companyId");

ALTER TABLE "AmountClaim" ADD CONSTRAINT "AmountClaim_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AmountClaim" ADD CONSTRAINT "AmountClaim_positionId_fkey"
  FOREIGN KEY ("positionId") REFERENCES "Position"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AmountClaim" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "AmountClaim" FROM anon, authenticated;
