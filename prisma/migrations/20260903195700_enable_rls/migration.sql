-- Lock every table against the Supabase Data API.
--
-- These tables live in the `public` schema, which PostgREST exposes to anyone
-- holding the anon key — and the anon key is shipped to the browser by design.
-- Enabling RLS with no policies means the anon and authenticated roles can read
-- nothing at all. The app is unaffected: Prisma connects as the table owner,
-- which bypasses RLS.
--
-- If a policy is ever added here, it must key off Company.userId and friends.
ALTER TABLE "Company" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Contact" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Position" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Transaction" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Valuation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "GmailAccount" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Update" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "UpdateMetric" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Signal" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ActionItem" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Document" ENABLE ROW LEVEL SECURITY;

-- Belt and braces: revoke the API roles' table grants outright.
REVOKE ALL ON ALL TABLES IN SCHEMA "public" FROM anon, authenticated;
