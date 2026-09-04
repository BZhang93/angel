// Enum option lists for forms, in the order a human would expect to see them.
import { titleCase } from "@/lib/format";

const options = (values: string[]) =>
  values.map((value) => ({ value, label: titleCase(value) }));

export const INSTRUMENT_OPTIONS = options([
  "SAFE",
  "KISS",
  "CONVERTIBLE_NOTE",
  "PRICED_EQUITY",
  "SPV_LP",
  "TOKEN_WARRANT",
  "OTHER",
]);

/// What a vehicle holds in the company. "Direct" means the investor holds the
/// instrument themselves, so instrumentType already says it.
export const UNDERLYING_OPTIONS = [
  { value: "", label: "Direct or unknown" },
  ...options(["SAFE", "KISS", "CONVERTIBLE_NOTE", "PRICED_EQUITY", "TOKEN_WARRANT", "OTHER"]),
];

export const HOLDING_ENTITY_OPTIONS = options(["PERSONAL", "LLC", "TRUST", "IRA", "OTHER"]);

export const STAGE_OPTIONS = options([
  "PRE_SEED",
  "SEED",
  "SERIES_A",
  "SERIES_B",
  "SERIES_C_PLUS",
  "GROWTH",
  "UNKNOWN",
]);

export const STATUS_OPTIONS = options(["ACTIVE", "ACQUIRED", "IPO", "SHUT_DOWN", "UNKNOWN"]);

export const TRANSACTION_OPTIONS = options([
  "INVESTMENT",
  "CAPITAL_CALL",
  "FEE",
  "DISTRIBUTION",
  "SECONDARY_SALE",
  "WRITE_OFF",
]);

export const VALUATION_SOURCE_OPTIONS = [
  { value: "ROUND", label: "Priced round" },
  { value: "SECONDARY", label: "Secondary" },
  { value: "FOUR_O_NINE_A", label: "409A" },
  { value: "ESTIMATE", label: "Estimate" },
];

export const ACTION_KIND_OPTIONS = [
  { value: "PRO_RATA", label: "Pro rata" },
  { value: "CONSENT", label: "Consent" },
  { value: "TAX_DOC", label: "Tax document" },
  { value: "INTRO", label: "Intro" },
  { value: "FOLLOW_UP", label: "Follow up" },
  { value: "PAYMENT_DUE", label: "Payment due" },
];
