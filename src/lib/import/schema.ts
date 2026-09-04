import { z } from "zod";

// What a mailbox scan may propose. Deliberately narrower than the full data
// model: an importer that guesses at terms creates work rather than saving it,
// so every field is nullable and every claim needs a quote.
//
// A sender group produces a LIST of companies, not one. Syndicate and SPV
// platforms send all their mail from a single domain covering many underlying
// businesses; proposing the manager as a portfolio company is wrong, and
// collapsing three investments into one loses the portfolio.

export const ProposedPositionSchema = z.object({
  instrumentType: z.enum([
    "SAFE",
    "CONVERTIBLE_NOTE",
    "PRICED_EQUITY",
    "SPV_LP",
    "TOKEN_WARRANT",
    "OTHER",
  ]),
  amount: z
    .number()
    .nullable()
    .describe(
      "The READER's own investment, in dollars. Never the total size of an SPV or round. If only a total is stated, use null.",
    ),
  /// Separately tracked because fees buy no ownership: they drag the return and
  /// belong in the ledger as their own line.
  feesAmount: z
    .number()
    .nullable()
    .describe("Legal, admin or setup fees the reader paid on top of the investment."),
  investmentDate: z.string().nullable().describe("ISO date (YYYY-MM-DD)."),
  /// A commitment with a wire deadline is not the same as money that left the
  /// account. False produces a 'confirm the wire' action item on import.
  amountConfirmed: z
    .boolean()
    .describe(
      "True only if the emails show the money was actually sent or received. A commitment with a future wire deadline is false.",
    ),
  valuationCap: z.number().nullable(),
  discountPct: z.number().nullable(),
  safeIsPostMoney: z.boolean().nullable(),
  interestRatePct: z.number().nullable(),
  maturityDate: z.string().nullable().describe("ISO date (YYYY-MM-DD)."),
  hasProRata: z.boolean().nullable(),
  /// Who stated the amount. The investor's own reply is the strongest evidence
  /// of what they committed; a syndicate's announcement is about the round.
  statedBy: z
    .enum(["INVESTOR", "SYNDICATE", "COMPANY", "BANK", "DOCUMENT", "UNKNOWN"])
    .describe("Who wrote the email the amount came from."),
  sourceQuote: z.string().describe("The sentence evidencing this investment."),
  confidence: z.number().min(0).max(1),
});

export const CompanyProposalSchema = z.object({
  name: z.string().describe("The OPERATING company's name, never the syndicate or SPV manager."),
  /// Set when the investment came through a syndicate, SPV or platform. The
  /// vehicle is recorded against the position; it never becomes a company.
  investmentGroup: z
    .string()
    .nullable()
    .describe(
      "The syndicate, SPV manager or platform this went through, e.g. 'Viaka' or 'AngelList'. Null for a direct investment.",
    ),
  website: z.string().nullable(),
  sector: z.string().nullable().describe("Two or three words, e.g. 'Developer tools'."),
  stage: z.enum(["PRE_SEED", "SEED", "SERIES_A", "SERIES_B", "SERIES_C_PLUS", "GROWTH", "UNKNOWN"]),
  description: z.string().nullable().describe("One sentence on what the company does."),
  contactName: z.string().nullable(),
  contactEmail: z.string().nullable(),
  positions: z.array(ProposedPositionSchema),
  confidence: z.number().min(0).max(1).describe("Confidence that this is a real investment."),
  notes: z
    .string()
    .nullable()
    .describe("Anything the reviewer should check, e.g. an amount that was never stated."),
});

export const ScanGroupSchema = z.object({
  /// The sender's own identity, used only to explain what was skipped.
  senderIsSyndicate: z
    .boolean()
    .describe("True if the sender is a syndicate, SPV manager or investment platform."),
  companies: z
    .array(CompanyProposalSchema)
    .describe("One entry per operating company actually invested in. Empty if none."),
  skippedReason: z
    .string()
    .nullable()
    .describe("If companies is empty, one line on why these emails are not an investment."),
});

export type Proposal = z.infer<typeof CompanyProposalSchema>;
export type ScanGroup = z.infer<typeof ScanGroupSchema>;
export type ProposedPosition = z.infer<typeof ProposedPositionSchema>;
