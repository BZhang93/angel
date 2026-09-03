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

export const ExtractionSchema = z.object({
  summary: z.string().describe("Two sentences at most, factual, no editorialising."),
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
