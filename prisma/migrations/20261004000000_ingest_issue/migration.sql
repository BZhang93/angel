-- Makes "this update carried no content" a visible state instead of something
-- indistinguishable from a quiet month.
CREATE TYPE "IngestIssue" AS ENUM ('TRUNCATED_BODY', 'NOTHING_EXTRACTED');

ALTER TABLE "Update" ADD COLUMN "ingestIssue" "IngestIssue";
