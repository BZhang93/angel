-- The vehicle an investment was made through (a syndicate, SPV manager or
-- platform). It belongs on the position rather than the company: the same
-- company can be held directly and through a vehicle, on different terms.
ALTER TABLE "Position" ADD COLUMN "investmentGroup" TEXT;

-- A syndicate's mail covers several underlying companies, so a sender domain
-- can now produce several candidates. The candidate key gains the proposed
-- company name, and carries the vehicle it came through.
ALTER TABLE "ImportCandidate" ADD COLUMN "investmentGroup" TEXT;
DROP INDEX "ImportCandidate_userId_sourceDomain_key";
CREATE UNIQUE INDEX "ImportCandidate_userId_sourceDomain_proposedName_key"
  ON "ImportCandidate"("userId", "sourceDomain", "proposedName");
