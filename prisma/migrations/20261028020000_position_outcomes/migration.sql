-- The full set of ways a position ends, not just the one that came up first.
-- Recreated rather than extended with ALTER TYPE ... ADD VALUE, which cannot
-- run inside the transaction a migration is applied in.

ALTER TABLE "Position" ALTER COLUMN "status" DROP DEFAULT;
ALTER TYPE "PositionStatus" RENAME TO "PositionStatus_old";

CREATE TYPE "PositionStatus" AS ENUM (
  'ACTIVE',
  'EXITED',
  'SECONDARY_SOLD',
  'REPAID',
  'WRITTEN_OFF',
  'REFUNDED',
  'CANCELLED'
);

ALTER TABLE "Position"
  ALTER COLUMN "status" TYPE "PositionStatus" USING ("status"::text::"PositionStatus");
ALTER TABLE "Position" ALTER COLUMN "status" SET DEFAULT 'ACTIVE';

DROP TYPE "PositionStatus_old";
