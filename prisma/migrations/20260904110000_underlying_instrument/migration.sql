-- An investment through a syndicate is two instruments stacked: the investor
-- holds an LP interest in the SPV, and the SPV holds a SAFE (or a note, or
-- equity) in the company. Recording only the wrapper loses the exposure that
-- actually matters.
ALTER TYPE "InstrumentType" ADD VALUE 'KISS' AFTER 'SAFE';
