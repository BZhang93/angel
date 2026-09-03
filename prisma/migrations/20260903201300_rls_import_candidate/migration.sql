-- Same lockdown as every other table: no access for the Data API roles.
ALTER TABLE "ImportCandidate" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "ImportCandidate" FROM anon, authenticated;
