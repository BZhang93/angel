-- The signer's own DocuSign user id. Without it an envelope search only covers
-- what the account sent, and an angel is the signer, not the sender.
ALTER TABLE "DocusignAccount" ADD COLUMN "docusignUserId" TEXT;
