-- An action item that money settles, rather than a person.
ALTER TYPE "ActionKind" ADD VALUE IF NOT EXISTS 'PAYMENT_DUE';
ALTER TABLE "ActionItem" ADD COLUMN IF NOT EXISTS "amount" DECIMAL(18,2);
