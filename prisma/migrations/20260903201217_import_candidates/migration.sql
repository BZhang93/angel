-- CreateEnum
CREATE TYPE "CandidateState" AS ENUM ('PROPOSED', 'IMPORTED', 'DISMISSED');

-- CreateTable
CREATE TABLE "ImportCandidate" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sourceDomain" TEXT NOT NULL,
    "proposedName" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "emailCount" INTEGER NOT NULL DEFAULT 0,
    "confidence" DECIMAL(4,3),
    "state" "CandidateState" NOT NULL DEFAULT 'PROPOSED',
    "companyId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ImportCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ImportCandidate_userId_state_idx" ON "ImportCandidate"("userId", "state");

-- CreateIndex
CREATE UNIQUE INDEX "ImportCandidate_userId_sourceDomain_key" ON "ImportCandidate"("userId", "sourceDomain");
