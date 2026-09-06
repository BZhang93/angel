-- Severity says how urgent a signal is, never which way it points.
CREATE TYPE "SignalDirection" AS ENUM ('POSITIVE', 'NEGATIVE', 'NEUTRAL');
ALTER TABLE "Signal" ADD COLUMN IF NOT EXISTS "direction" "SignalDirection" NOT NULL DEFAULT 'NEUTRAL';
ALTER TYPE "SignalKind" ADD VALUE IF NOT EXISTS 'PARTNERSHIP';
