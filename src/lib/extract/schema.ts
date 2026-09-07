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

export const SIGNAL_DIRECTIONS = ["POSITIVE", "NEGATIVE", "NEUTRAL"] as const;

export const SIGNAL_KINDS = [
  "RISK",
  "ASK",
  "MILESTONE",
  "PARTNERSHIP",
  "PERSONNEL_CHANGE",
  "FUNDRAISE",
] as const;

export const SEVERITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;

export const ACTION_KINDS = [
  "PRO_RATA",
  "CONSENT",
  "TAX_DOC",
  "INTRO",
  "FOLLOW_UP",
  "PAYMENT_DUE",
] as const;

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
      /// Independent of severity, which measures urgency rather than which way
      /// the news points. A founder leaving and a founder joining are both a
      /// PERSONNEL_CHANGE and may both be urgent.
      direction: z
        .enum(SIGNAL_DIRECTIONS)
        .describe(
          "Whether this is good or bad news for the business. A departure, a lost customer, a missed target or a delay is NEGATIVE; a hire, a launch, a signed partnership or a raise is POSITIVE. NEUTRAL when it is genuinely neither, or when the email does not make it clear.",
        ),
      summary: z.string(),
      sourceQuote: z.string(),
      confidence: z.number().min(0).max(1),
    }),
  ),
  /// A syndicate saying the money is in, with none of a bank confirmation's
  /// structure. "All wires received" carries no amount, beneficiary or
  /// reference, so it produces no Payment, and a company funded this way kept
  /// its wire reminder open forever.
  fundingComplete: z
    .object({
      sourceQuote: z.string().describe("The sentence saying the funding is done."),
    })
    .nullable()
    .describe(
      "Set only when the email states that funding, wiring or the round is COMPLETE for this company: 'all wires received', 'the SPV is funded', 'we have wired the investment'. A deadline, a request to wire, a discussion of a refund, or a partial update is not this. Null otherwise.",
    ),
  actionItems: z.array(
    z.object({
      kind: z.enum(ACTION_KINDS),
      title: z.string(),
      detail: z.string().nullable(),
      /// Only for PAYMENT_DUE, and only when a figure is actually stated. This
      /// is what lets a confirmed transfer close the reminder, so a guess here
      /// would silently clear a debt that is still owed.
      amount: z
        .number()
        .nullable()
        .describe(
          "For PAYMENT_DUE only: the dollar amount the reader must send or is owed, when the email states one. Null for every other kind, and null if no figure is given.",
        ),
      dueDate: z
        .string()
        .nullable()
        .describe("ISO date (YYYY-MM-DD) if the email states one, else null."),
      sourceQuote: z.string(),
    }),
  ),
});

export type Extraction = z.infer<typeof ExtractionSchema>;
