import { z } from "zod";

// The extraction contract. Everything the model returns must carry a verbatim
// quote from the email, so any number in the UI can be traced back to the
// sentence that produced it.

export const METRIC_KEYS = [
  "ARR",
  "MRR",
  "REVENUE",
  "CASH",
  "BURN",
  "RUNWAY_MONTHS",
  "HEADCOUNT",
  "CUSTOMERS",
  "GROWTH_RATE",
] as const;

export const SIGNAL_KINDS = [
  "RISK",
  "ASK",
  "MILESTONE",
  "PERSONNEL_CHANGE",
  "FUNDRAISE",
] as const;

export const SEVERITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;

export const ACTION_KINDS = ["PRO_RATA", "CONSENT", "TAX_DOC", "INTRO", "FOLLOW_UP"] as const;

/// A bank transfer confirmation found in the mailbox. Independent evidence
/// that money actually moved, which no investor update ever proves.
export const PaymentSchema = z.object({
  amount: z.number().describe("The gross amount that left the account, fees included."),
  currency: z.string().describe("ISO code, e.g. USD."),
  valueDate: z.string().describe("The date the transfer settled or was sent, ISO YYYY-MM-DD."),
  beneficiary: z.string().nullable().describe("Who received it, as the bank wrote it."),
  reference: z.string().nullable().describe("Payment reference or memo line."),
  /// Fees named in the same email, so the investment can be separated from the
  /// total that left the account.
  statedFees: z.number().nullable().describe("Legal, admin or setup fees stated in this email."),
  companyName: z
    .string()
    .nullable()
    .describe("The company or fund the money was for, if the email names one."),
  sourceQuote: z.string().describe("The sentence stating the amount."),
});

export const ExtractionSchema = z.object({
  summary: z.string().describe("Two sentences at most, factual, no editorialising."),
  /// Set when this email is a bank transfer confirmation rather than an update.
  payment: PaymentSchema.nullable(),
  /// Set when this email is a signed-document notification (DocuSign and the
  /// like), which proves execution but not payment.
  execution: z
    .object({
      documentTitle: z.string(),
      signedDate: z.string().nullable().describe("ISO YYYY-MM-DD."),
      companyName: z.string().nullable(),
      sourceQuote: z.string(),
    })
    .nullable(),
  metrics: z.array(
    z.object({
      key: z.enum(METRIC_KEYS),
      value: z.number().describe("Absolute number in the unit given; 1.2M becomes 1200000."),
      unit: z.string().nullable().describe("USD, months, people, percent."),
      periodLabel: z.string().nullable().describe("The period as written, e.g. 'Q2 2026'."),
      sourceQuote: z.string().describe("The sentence from the email containing this number."),
      confidence: z.number().min(0).max(1),
    }),
  ),
  signals: z.array(
    z.object({
      kind: z.enum(SIGNAL_KINDS),
      severity: z.enum(SEVERITIES),
      summary: z.string(),
      sourceQuote: z.string(),
      confidence: z.number().min(0).max(1),
    }),
  ),
  actionItems: z.array(
    z.object({
      kind: z.enum(ACTION_KINDS),
      title: z.string(),
      detail: z.string().nullable(),
      dueDate: z
        .string()
        .nullable()
        .describe("ISO date (YYYY-MM-DD) if the email states one, else null."),
      sourceQuote: z.string(),
    }),
  ),
});

export type Extraction = z.infer<typeof ExtractionSchema>;
