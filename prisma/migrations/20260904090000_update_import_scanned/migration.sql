-- When the import scan last read an email looking for companies, so a rescan
-- only pays to read what is new. The fetch was already skipped for stored mail;
-- this skips the model, which is the expensive half.
ALTER TABLE "Update" ADD COLUMN "importScannedAt" TIMESTAMP(3);

-- Nothing has been read under the batched scan yet, so everything stays
-- unscanned and the next run reads it once.
