-- Links found in an email body, tracking and unsubscribe noise removed.
ALTER TABLE "Update" ADD COLUMN "links" TEXT[] DEFAULT ARRAY[]::TEXT[];
