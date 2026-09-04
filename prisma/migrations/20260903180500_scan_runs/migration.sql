-- Progress for long-running scans, so the UI can show results arriving instead
-- of a spinner that lasts minutes.
CREATE TYPE "ScanKind" AS ENUM ('IMPORT_SCAN', 'SYNC', 'COMPANY_SCAN');
CREATE TYPE "ScanState" AS ENUM ('RUNNING', 'DONE', 'FAILED');

CREATE TABLE "ScanRun" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "kind" "ScanKind" NOT NULL,
  "state" "ScanState" NOT NULL DEFAULT 'RUNNING',
  "totalItems" INTEGER NOT NULL DEFAULT 0,
  "doneItems" INTEGER NOT NULL DEFAULT 0,
  "produced" INTEGER NOT NULL DEFAULT 0,
  "step" TEXT,
  "message" TEXT,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finishedAt" TIMESTAMP(3),
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ScanRun_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ScanRun_userId_kind_startedAt_idx" ON "ScanRun"("userId", "kind", "startedAt");

-- Locked down like every other table: the Data API roles get nothing.
ALTER TABLE "ScanRun" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "ScanRun" FROM anon, authenticated;
