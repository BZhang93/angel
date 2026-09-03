import { z } from "zod";

// What a mailbox scan may propose for one company. Deliberately narrower than
// the full data model: an importer that guesses at terms creates work rather
// than saving it, so every field is nullable and every claim needs a quote.

export const ProposedPositionSchema = z.object({
  instrumentType: z.enum([
    "SAFE",
    "CONVERTIBLE_NOTE",
    "PRICED_EQUITY",
    "SPV_LP",
    "TOKEN_WARRANT",
    "OTHER",
  ]),
  amount: z.number().nullable().describe("The amount invested, in dollars."),
  investmentDate: z.string().nullable().describe("ISO date (YYYY-MM-DD)."),
  valuationCap: z.number().nullable(),
  discountPct: z.number().nullable(),
  safeIsPostMoney: z.boolean().nullable(),
  interestRatePct: z.number().nullable(),
  maturityDate: z.string().nullable().describe("ISO date (YYYY-MM-DD)."),
  hasProRata: z.boolean().nullable(),
  sourceQuote: z.string().describe("The sentence evidencing this investment."),
  confidence: z.number().min(0).max(1),
});

export const ProposalSchema = z.object({
  isInvestment: z
    .boolean()
    .describe(
      "True only if the emails show the reader actually invested money in this company. A pitch, a newsletter or a rejected deal is false.",
    ),
  name: z.string().describe("The company's proper name as written in the emails."),
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

export type Proposal = z.infer<typeof ProposalSchema>;
export type ProposedPosition = z.infer<typeof ProposedPositionSchema>;
