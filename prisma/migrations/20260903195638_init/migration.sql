-- CreateEnum
CREATE TYPE "CompanyStatus" AS ENUM ('ACTIVE', 'ACQUIRED', 'IPO', 'SHUT_DOWN', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "Stage" AS ENUM ('PRE_SEED', 'SEED', 'SERIES_A', 'SERIES_B', 'SERIES_C_PLUS', 'GROWTH', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "InstrumentType" AS ENUM ('SAFE', 'CONVERTIBLE_NOTE', 'PRICED_EQUITY', 'SPV_LP', 'TOKEN_WARRANT', 'OTHER');

-- CreateEnum
CREATE TYPE "HoldingEntity" AS ENUM ('PERSONAL', 'LLC', 'TRUST', 'IRA', 'OTHER');

-- CreateEnum
CREATE TYPE "TransactionKind" AS ENUM ('INVESTMENT', 'CAPITAL_CALL', 'FEE', 'DISTRIBUTION', 'SECONDARY_SALE', 'WRITE_OFF');

-- CreateEnum
CREATE TYPE "ValuationSource" AS ENUM ('ROUND', 'SECONDARY', 'FOUR_O_NINE_A', 'ESTIMATE');

-- CreateEnum
CREATE TYPE "ReviewState" AS ENUM ('PENDING', 'CONFIRMED', 'REJECTED');

-- CreateEnum
CREATE TYPE "MetricKey" AS ENUM ('ARR', 'MRR', 'REVENUE', 'CASH', 'BURN', 'RUNWAY_MONTHS', 'HEADCOUNT', 'CUSTOMERS', 'GROWTH_RATE');

-- CreateEnum
CREATE TYPE "SignalKind" AS ENUM ('RISK', 'ASK', 'MILESTONE', 'PERSONNEL_CHANGE', 'FUNDRAISE');

-- CreateEnum
CREATE TYPE "Severity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "ActionKind" AS ENUM ('PRO_RATA', 'CONSENT', 'TAX_DOC', 'INTRO', 'FOLLOW_UP');

-- CreateEnum
CREATE TYPE "ActionState" AS ENUM ('OPEN', 'DONE', 'DISMISSED');

-- CreateEnum
CREATE TYPE "DocumentKind" AS ENUM ('SAFE', 'NOTE', 'SIDE_LETTER', 'EQUITY_DOCS', 'CAP_TABLE', 'K1', 'TAX_OTHER', 'OTHER');

-- CreateTable
CREATE TABLE "Company" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "website" TEXT,
    "description" TEXT,
    "sector" TEXT,
    "stage" "Stage" NOT NULL DEFAULT 'UNKNOWN',
    "hqCountry" TEXT,
    "status" "CompanyStatus" NOT NULL DEFAULT 'ACTIVE',
    "sourcedBy" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Company_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Contact" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "role" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Contact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Position" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "instrumentType" "InstrumentType" NOT NULL,
    "holdingEntity" "HoldingEntity" NOT NULL DEFAULT 'PERSONAL',
    "investmentDate" TIMESTAMP(3) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "valuationCap" DECIMAL(18,2),
    "discountPct" DECIMAL(5,2),
    "safeIsPostMoney" BOOLEAN,
    "hasMfn" BOOLEAN NOT NULL DEFAULT false,
    "hasProRata" BOOLEAN NOT NULL DEFAULT false,
    "interestRatePct" DECIMAL(5,2),
    "maturityDate" TIMESTAMP(3),
    "shareClass" TEXT,
    "shareCount" DECIMAL(18,4),
    "pricePerShare" DECIMAL(18,6),
    "liquidationPreferenceX" DECIMAL(5,2),
    "ownershipPct" DECIMAL(8,5),
    "committedAmount" DECIMAL(18,2),
    "managementFeePct" DECIMAL(5,2),
    "carryPct" DECIMAL(5,2),
    "qsbsEligible" BOOLEAN NOT NULL DEFAULT false,
    "convertedIntoId" TEXT,
    "convertedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Position_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Transaction" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "positionId" TEXT NOT NULL,
    "kind" "TransactionKind" NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "date" TIMESTAMP(3) NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Transaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Valuation" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "pricePerShare" DECIMAL(18,6),
    "postMoneyValuation" DECIMAL(18,2),
    "source" "ValuationSource" NOT NULL DEFAULT 'ESTIMATE',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Valuation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GmailAccount" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "emailAddress" TEXT NOT NULL,
    "refreshTokenEncrypted" TEXT NOT NULL,
    "syncQuery" TEXT NOT NULL DEFAULT 'label:investments',
    "lastHistoryId" TEXT,
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GmailAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Update" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "companyId" TEXT,
    "gmailMessageId" TEXT NOT NULL,
    "gmailThreadId" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "fromAddress" TEXT NOT NULL,
    "fromName" TEXT,
    "subject" TEXT,
    "rawText" TEXT NOT NULL,
    "summary" TEXT,
    "matchConfidence" DECIMAL(4,3),
    "reviewState" "ReviewState" NOT NULL DEFAULT 'PENDING',
    "extractedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Update_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UpdateMetric" (
    "id" TEXT NOT NULL,
    "updateId" TEXT NOT NULL,
    "key" "MetricKey" NOT NULL,
    "value" DECIMAL(18,2) NOT NULL,
    "unit" TEXT,
    "periodLabel" TEXT,
    "sourceQuote" TEXT,
    "confidence" DECIMAL(4,3),
    "editedByUser" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UpdateMetric_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Signal" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "updateId" TEXT,
    "kind" "SignalKind" NOT NULL,
    "severity" "Severity" NOT NULL DEFAULT 'MEDIUM',
    "summary" TEXT NOT NULL,
    "sourceQuote" TEXT,
    "confidence" DECIMAL(4,3),
    "derived" BOOLEAN NOT NULL DEFAULT false,
    "editedByUser" BOOLEAN NOT NULL DEFAULT false,
    "dismissedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Signal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActionItem" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "updateId" TEXT,
    "kind" "ActionKind" NOT NULL,
    "title" TEXT NOT NULL,
    "detail" TEXT,
    "dueDate" TIMESTAMP(3),
    "state" "ActionState" NOT NULL DEFAULT 'OPEN',
    "sourceQuote" TEXT,
    "editedByUser" BOOLEAN NOT NULL DEFAULT false,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ActionItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Document" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "companyId" TEXT,
    "positionId" TEXT,
    "kind" "DocumentKind" NOT NULL DEFAULT 'OTHER',
    "title" TEXT NOT NULL,
    "storagePath" TEXT NOT NULL,
    "sizeBytes" INTEGER,
    "mimeType" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Company_userId_status_idx" ON "Company"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Company_userId_name_key" ON "Company"("userId", "name");

-- CreateIndex
CREATE INDEX "Contact_companyId_idx" ON "Contact"("companyId");

-- CreateIndex
CREATE INDEX "Contact_email_idx" ON "Contact"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Position_convertedIntoId_key" ON "Position"("convertedIntoId");

-- CreateIndex
CREATE INDEX "Position_userId_idx" ON "Position"("userId");

-- CreateIndex
CREATE INDEX "Position_companyId_idx" ON "Position"("companyId");

-- CreateIndex
CREATE INDEX "Transaction_userId_idx" ON "Transaction"("userId");

-- CreateIndex
CREATE INDEX "Transaction_positionId_date_idx" ON "Transaction"("positionId", "date");

-- CreateIndex
CREATE INDEX "Valuation_userId_idx" ON "Valuation"("userId");

-- CreateIndex
CREATE INDEX "Valuation_companyId_date_idx" ON "Valuation"("companyId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "GmailAccount_userId_key" ON "GmailAccount"("userId");

-- CreateIndex
CREATE INDEX "Update_userId_receivedAt_idx" ON "Update"("userId", "receivedAt");

-- CreateIndex
CREATE INDEX "Update_companyId_receivedAt_idx" ON "Update"("companyId", "receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Update_userId_gmailMessageId_key" ON "Update"("userId", "gmailMessageId");

-- CreateIndex
CREATE INDEX "UpdateMetric_updateId_idx" ON "UpdateMetric"("updateId");

-- CreateIndex
CREATE INDEX "Signal_userId_kind_idx" ON "Signal"("userId", "kind");

-- CreateIndex
CREATE INDEX "Signal_companyId_idx" ON "Signal"("companyId");

-- CreateIndex
CREATE INDEX "Signal_updateId_idx" ON "Signal"("updateId");

-- CreateIndex
CREATE INDEX "ActionItem_userId_state_dueDate_idx" ON "ActionItem"("userId", "state", "dueDate");

-- CreateIndex
CREATE INDEX "ActionItem_companyId_idx" ON "ActionItem"("companyId");

-- CreateIndex
CREATE INDEX "Document_userId_idx" ON "Document"("userId");

-- CreateIndex
CREATE INDEX "Document_companyId_idx" ON "Document"("companyId");

-- AddForeignKey
ALTER TABLE "Contact" ADD CONSTRAINT "Contact_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Position" ADD CONSTRAINT "Position_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Position" ADD CONSTRAINT "Position_convertedIntoId_fkey" FOREIGN KEY ("convertedIntoId") REFERENCES "Position"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "Position"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Valuation" ADD CONSTRAINT "Valuation_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Update" ADD CONSTRAINT "Update_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UpdateMetric" ADD CONSTRAINT "UpdateMetric_updateId_fkey" FOREIGN KEY ("updateId") REFERENCES "Update"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Signal" ADD CONSTRAINT "Signal_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Signal" ADD CONSTRAINT "Signal_updateId_fkey" FOREIGN KEY ("updateId") REFERENCES "Update"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActionItem" ADD CONSTRAINT "ActionItem_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActionItem" ADD CONSTRAINT "ActionItem_updateId_fkey" FOREIGN KEY ("updateId") REFERENCES "Update"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "Position"("id") ON DELETE SET NULL ON UPDATE CASCADE;
