-- Auto-sync, served by a Gmail push subscription where one is configured and a
-- scheduled poll otherwise.
ALTER TABLE "GmailAccount" ADD COLUMN "autoSync" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "GmailAccount" ADD COLUMN "watchExpiresAt" TIMESTAMP(3);
