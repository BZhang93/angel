-- A position can end without the company ending. An SPV that collects the
-- wires and then returns them leaves a company that is still very much alive
-- and a position that no longer exists, which CompanyStatus cannot express.

CREATE TYPE "PositionStatus" AS ENUM ('ACTIVE', 'REFUNDED');

ALTER TABLE "Position"
  ADD COLUMN "status" "PositionStatus" NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN "closedAt" TIMESTAMP(3);
