-- Bank transfer confirmations: independent evidence that money actually moved,
-- which an investor update never proves.
CREATE TYPE "PaymentState" AS ENUM ('UNMATCHED', 'CONFIRMED', 'DISCREPANCY', 'IGNORED');

CREATE TABLE "Payment" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "updateId" TEXT,
  "companyId" TEXT,
  "positionId" TEXT,
  "amount" DECIMAL(18,2) NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'USD',
  "valueDate" TIMESTAMP(3) NOT NULL,
  "beneficiary" TEXT,
  "reference" TEXT,
  "state" "PaymentState" NOT NULL DEFAULT 'UNMATCHED',
  "note" TEXT,
  "sourceQuote" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Payment_userId_state_idx" ON "Payment"("userId", "state");
CREATE INDEX "Payment_companyId_idx" ON "Payment"("companyId");

ALTER TABLE "Payment" ADD CONSTRAINT "Payment_updateId_fkey"
  FOREIGN KEY ("updateId") REFERENCES "Update"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_positionId_fkey"
  FOREIGN KEY ("positionId") REFERENCES "Position"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Payment" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "Payment" FROM anon, authenticated;
