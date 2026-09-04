import { describe, expect, it } from "vitest";
import { dedupePositions, isSameInvestment, mergeInvestment, mergeProposals } from "./merge";
import type { Proposal, ProposedPosition } from "./schema";

const position = (over: Partial<ProposedPosition> = {}): ProposedPosition => ({
  instrumentType: "SPV_LP",
  amount: null,
  feesAmount: null,
  investmentDate: null,
  amountConfirmed: false,
  valuationCap: null,
  discountPct: null,
  safeIsPostMoney: null,
  interestRatePct: null,
  maturityDate: null,
  hasProRata: null,
  statedBy: "UNKNOWN",
  sourceQuote: "quote",
  confidence: 0.8,
  ...over,
});

const proposal = (over: Partial<Proposal> = {}): Proposal => ({
  name: "Vessel",
  investmentGroup: "Viaka",
  website: null,
  sector: null,
  stage: "UNKNOWN",
  description: null,
  contactName: null,
  contactEmail: null,
  positions: [],
  confidence: 0.8,
  notes: null,
  ...over,
});

describe("isSameInvestment", () => {
  it("treats the same amount days apart as one deal", () => {
    // Vessel: the syndicate announced $5,840 on the 1st and confirmed on the 8th.
    expect(
      isSameInvestment(
        position({ amount: 5840, investmentDate: "2025-08-01" }),
        position({ amount: 5840, investmentDate: "2025-08-08" }),
      ),
    ).toBe(true);
  });

  it("treats a bank's gross as the same deal as the commitment it settles", () => {
    // $6,424 wired against $5,840 committed: the $584 is the fee.
    expect(
      isSameInvestment(
        position({ amount: 5840, investmentDate: "2025-08-01", statedBy: "INVESTOR" }),
        position({ amount: 6424, investmentDate: "2025-08-11", statedBy: "BANK" }),
      ),
    ).toBe(true);
  });

  it("keeps genuinely different cheques apart", () => {
    expect(
      isSameInvestment(
        position({ amount: 2000, investmentDate: "2026-01-10" }),
        position({ amount: 9000, investmentDate: "2026-01-12" }),
      ),
    ).toBe(false);
  });

  it("keeps a follow-on months later apart", () => {
    expect(
      isSameInvestment(
        position({ amount: 2000, investmentDate: "2026-01-10" }),
        position({ amount: 2000, investmentDate: "2026-09-10" }),
      ),
    ).toBe(false);
  });
});

describe("mergeInvestment", () => {
  it("keeps the committed amount and books the wire's excess as fees", () => {
    const merged = mergeInvestment(
      position({ amount: 5840, investmentDate: "2025-08-01", statedBy: "INVESTOR" }),
      position({ amount: 6424, investmentDate: "2025-08-11", statedBy: "BANK", amountConfirmed: true }),
    );
    expect(merged.amount).toBe(5840);
    expect(merged.feesAmount).toBe(584);
    // The wire proves the money moved, even though the amount came from elsewhere.
    expect(merged.amountConfirmed).toBe(true);
  });

  it("prefers what the investor said over what the syndicate announced", () => {
    const merged = mergeInvestment(
      position({ amount: 30500, statedBy: "SYNDICATE", investmentDate: "2026-08-31" }),
      position({ amount: 2189, statedBy: "INVESTOR", investmentDate: "2026-08-11" }),
    );
    expect(merged.amount).toBe(2189);
  });

  it("fills terms from whichever source knew them", () => {
    const merged = mergeInvestment(
      position({ amount: 2000, statedBy: "INVESTOR" }),
      position({ amount: 2000, statedBy: "DOCUMENT", valuationCap: 8_000_000, discountPct: 20 }),
    );
    expect(merged.valuationCap).toBe(8_000_000);
    expect(merged.discountPct).toBe(20);
  });
});

describe("dedupePositions", () => {
  it("collapses one deal described three times into one position", () => {
    const merged = dedupePositions([
      position({ amount: 5840, investmentDate: "2025-08-01", statedBy: "SYNDICATE" }),
      position({ amount: 5840, investmentDate: "2025-08-08", statedBy: "INVESTOR" }),
      position({ amount: 6424, investmentDate: "2025-08-11", statedBy: "BANK" }),
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.amount).toBe(5840);
    expect(merged[0]!.feesAmount).toBe(584);
  });

  it("leaves two real investments as two", () => {
    expect(
      dedupePositions([
        position({ amount: 2000, investmentDate: "2025-01-10" }),
        position({ amount: 5000, investmentDate: "2026-06-10" }),
      ]),
    ).toHaveLength(2);
  });
});

describe("mergeProposals", () => {
  it("combines what different senders knew about one company", () => {
    const merged = mergeProposals(
      proposal({
        name: "Asendia",
        positions: [position({ amount: 3000, investmentDate: "2026-08-27", statedBy: "INVESTOR" })],
      }),
      proposal({
        name: "Asendia AI",
        sector: "Logistics",
        positions: [
          position({ amount: 3283.5, investmentDate: "2026-09-03", statedBy: "BANK", amountConfirmed: true }),
        ],
      }),
    );

    expect(merged.name).toBe("Asendia AI");
    expect(merged.sector).toBe("Logistics");
    expect(merged.positions).toHaveLength(1);
    expect(merged.positions[0]!.amount).toBe(3000);
    expect(merged.positions[0]!.feesAmount).toBe(283.5);
  });
});
