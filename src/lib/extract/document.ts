import "server-only";
import { z } from "zod";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { aiConfigured, AiNotConfiguredError } from "@/lib/ai/client";

// Reading the instrument itself rather than the covering email.
//
// This is where the reliable terms live: a SAFE states its cap in a numbered
// clause, while the email says "signed and attached". Same provenance contract
// as every other extraction: each term quotes the clause it came from.

export const DocumentTermsSchema = z.object({
  documentKind: z.enum([
    "SAFE",
    "NOTE",
    "SIDE_LETTER",
    "EQUITY_DOCS",
    "CAP_TABLE",
    "K1",
    "TAX_OTHER",
    "OTHER",
  ]),
  companyName: z.string().nullable().describe("The issuing company as named in the document."),
  investorName: z.string().nullable().describe("The investing party, which may be an entity."),
  summary: z.string().describe("One or two sentences: what this document is and what it does."),
  isExecuted: z
    .boolean()
    .describe("True only if the document is signed or countersigned, not a draft or template."),
  amount: z.number().nullable().describe("The purchase amount, in dollars."),
  investmentDate: z.string().nullable().describe("Execution or effective date, ISO YYYY-MM-DD."),
  valuationCap: z.number().nullable(),
  discountPct: z.number().nullable(),
  safeIsPostMoney: z.boolean().nullable(),
  interestRatePct: z.number().nullable(),
  maturityDate: z.string().nullable().describe("ISO YYYY-MM-DD."),
  shareClass: z.string().nullable(),
  shareCount: z.number().nullable(),
  pricePerShare: z.number().nullable(),
  hasProRata: z.boolean().nullable(),
  sourceQuotes: z
    .record(z.string(), z.string())
    .describe("Field name to the verbatim clause it came from, for every non-null field above."),
});

export type DocumentTerms = z.infer<typeof DocumentTermsSchema>;

const SYSTEM = `You are reading a document attached to an angel investor's email: typically a SAFE, convertible note, side letter, stock purchase agreement, cap table or tax form.

Extract only what the document states.
- Never infer a term from convention. A SAFE with no discount clause has discountPct null, not 0.
- sourceQuotes must contain the verbatim clause behind every field you fill in, keyed by field name. If you cannot quote it, leave the field null.
- amount is the amount this investor purchased under this document, not the round or SPV total.
- isExecuted is true only for a signed or countersigned document. An unsigned template or draft is false.
- Post-money versus pre-money is stated in the SAFE's title or definitions; do not guess it from the year.
- If the document is not an investment document at all (a newsletter PDF, a deck), set documentKind OTHER, leave the terms null, and say what it is in summary.`;

let client: Anthropic | undefined;

export async function extractDocumentTerms(
  pdf: Buffer,
  context: { filename: string; companyName?: string | null },
): Promise<DocumentTerms> {
  if (!aiConfigured()) throw new AiNotConfiguredError();
  client ??= new Anthropic();

  const response = await client.messages.parse({
    model: process.env.AI_MODEL ?? "claude-opus-5",
    max_tokens: 16000,
    thinking: { type: "adaptive" },
    output_config: { effort: "medium", format: zodOutputFormat(DocumentTermsSchema) },
    system: SYSTEM,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "document",
            source: { type: "base64", media_type: "application/pdf", data: pdf.toString("base64") },
          },
          {
            type: "text",
            text: [
              `Filename: ${context.filename}`,
              context.companyName ? `Expected company: ${context.companyName}` : null,
              "Extract the terms of this document.",
            ]
              .filter((line) => line !== null)
              .join("\n"),
          },
        ],
      },
    ],
  });

  if (response.stop_reason === "refusal") {
    throw new Error(
      `Claude declined to read this document (${response.stop_details?.category ?? "unknown"}).`,
    );
  }
  if (!response.parsed_output) throw new Error("Document extraction returned no valid output.");
  return response.parsed_output;
}
