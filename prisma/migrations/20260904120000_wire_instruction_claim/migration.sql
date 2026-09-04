-- A syndicate's wire instructions state the fee exactly, which no other source
-- does before the money moves.
ALTER TYPE "ClaimSource" ADD VALUE IF NOT EXISTS 'WIRE_INSTRUCTION';
