ALTER TABLE "GmailAccount" ADD COLUMN "discoverOldestAt" TIMESTAMP(3);
ALTER TABLE "GmailAccount" ADD COLUMN "discoverBackfilledAt" TIMESTAMP(3);

-- Collapse any payment already booked twice before adding the constraint,
-- keeping the earliest row of each group so the claims pointing at it survive.
DELETE FROM "Payment" p
USING "Payment" keep
WHERE p."userId" = keep."userId"
  AND p."updateId" = keep."updateId"
  AND p."amount" = keep."amount"
  AND p."valueDate" = keep."valueDate"
  AND p."updateId" IS NOT NULL
  AND p."createdAt" > keep."createdAt";

CREATE UNIQUE INDEX "Payment_userId_updateId_amount_valueDate_key"
  ON "Payment" ("userId", "updateId", "amount", "valueDate");
