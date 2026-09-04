// Comparing what each source says was invested.
//
// A single investment gets asserted four or five times: the founder's
// commitment email, the confirmation with its fee, the bank's wire, the signed
// document, and whatever the user typed. They should agree. When they do not,
// the useful output is not "something is wrong" but which source disagrees and
// by how much, which is what this produces.
//
// Pure and tested: this decides whether a position is flagged for review.

export type ClaimSource =
  | "EMAIL_COMMITMENT"
  | "WIRE_INSTRUCTION"
  | "EMAIL_CONFIRMATION"
  | "BANK_TRANSFER"
  | "DOCUMENT"
  | "DOCUSIGN"
  | "MANUAL";

export type ClaimKind = "INVESTMENT" | "FEE" | "TOTAL";

export interface Claim {
  source: ClaimSource;
  kind: ClaimKind;
  amount: number;
}

export interface Discrepancy {
  /// "DocuSign's total amount does not match", ready to show.
  label: string;
  detail: string;
  source: ClaimSource;
  kind: ClaimKind;
}

const SOURCE_LABEL: Record<ClaimSource, string> = {
  EMAIL_COMMITMENT: "Your commitment email",
  WIRE_INSTRUCTION: "The wire instructions",
  EMAIL_CONFIRMATION: "The confirmation email",
  BANK_TRANSFER: "The bank transfer",
  DOCUMENT: "The signed document",
  DOCUSIGN: "DocuSign",
  MANUAL: "Your entry",
};

const KIND_LABEL: Record<ClaimKind, string> = {
  INVESTMENT: "amount",
  FEE: "fee",
  TOTAL: "total amount",
};

/// Cents, not dollars: banks and cap table software round differently and a
/// penny is not worth a person's attention.
const TOLERANCE = 0.02;

/// "The bank transfer's" but "The wire instructions'". Every other label is
/// singular, so the apostrophe-s was hardcoded until a plural one arrived.
function possessive(label: string): string {
  return label.endsWith("s") ? `${label}'` : `${label}'s`;
}

/// Agrees the verb with a plural label, for the same reason as above.
function says(label: string): string {
  return label.endsWith("s") ? "say" : "says";
}

function money(value: number): string {
  return `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/// The value the portfolio treats as true for a kind: whatever the user entered
/// if they entered one, else the most trustworthy source that stated it.
///
/// Which source is most trustworthy depends on what is being asserted, and
/// getting this backwards blames the wrong source in the tooltip. For what was
/// COMMITTED, the investor's own statements win: what they typed into the app,
/// then the signed document, then their own reply. A bank's gross figure is
/// about a wire, not a commitment, so it ranks low.
const TRUST_ORDER: ClaimSource[] = [
  "MANUAL",
  "DOCUSIGN",
  "DOCUMENT",
  "EMAIL_COMMITMENT",
  "WIRE_INSTRUCTION",
  "BANK_TRANSFER",
  "EMAIL_CONFIRMATION",
];

/// For a FEE or a TOTAL the order changes: those are about money that moved,
/// and the bank is the record of that. Wire instructions state the fee exactly,
/// which no one else does before the wire, but they state what was ASKED FOR.
/// A waived admin fee or a revised rate leaves the schedule stale while the
/// transfer stays right, so the bank outranks it once one exists.
const SETTLED_TRUST_ORDER: ClaimSource[] = [
  "MANUAL",
  "DOCUSIGN",
  "DOCUMENT",
  "BANK_TRANSFER",
  "WIRE_INSTRUCTION",
  "EMAIL_COMMITMENT",
  "EMAIL_CONFIRMATION",
];

function trustOrder(kind: ClaimKind): ClaimSource[] {
  return kind === "INVESTMENT" ? TRUST_ORDER : SETTLED_TRUST_ORDER;
}

export function agreedValue(claims: Claim[], kind: ClaimKind): Claim | null {
  const relevant = claims.filter((claim) => claim.kind === kind);
  if (relevant.length === 0) return null;

  for (const source of trustOrder(kind)) {
    const found = relevant.find((claim) => claim.source === source);
    if (found) return found;
  }
  return relevant[0]!;
}

/// Every source that disagrees with the agreed value, plus the cross-check that
/// a stated total should equal investment plus fees.
export function findDiscrepancies(claims: Claim[]): Discrepancy[] {
  const found: Discrepancy[] = [];

  for (const kind of ["INVESTMENT", "FEE", "TOTAL"] as ClaimKind[]) {
    const agreed = agreedValue(claims, kind);
    if (!agreed) continue;

    for (const claim of claims) {
      if (claim.kind !== kind || claim.source === agreed.source) continue;
      if (Math.abs(claim.amount - agreed.amount) <= TOLERANCE) continue;

      found.push({
        source: claim.source,
        kind,
        label: `${possessive(SOURCE_LABEL[claim.source])} ${KIND_LABEL[kind]} does not match`,
        detail: `${SOURCE_LABEL[claim.source]} ${says(SOURCE_LABEL[claim.source])} ${money(
          claim.amount,
        )}; ${SOURCE_LABEL[agreed.source].toLowerCase()} ${says(
          SOURCE_LABEL[agreed.source],
        )} ${money(agreed.amount)}.`,
      });
    }
  }

  // A gross wire should equal the investment plus the fees. This is the check
  // that catches a fee bundled into the wire but never recorded, which would
  // otherwise look like a clean match on the investment alone.
  const investment = agreedValue(claims, "INVESTMENT");
  const fee = agreedValue(claims, "FEE");
  for (const total of claims.filter((claim) => claim.kind === "TOTAL")) {
    if (!investment) continue;
    const expected = investment.amount + (fee?.amount ?? 0);
    if (Math.abs(total.amount - expected) <= TOLERANCE) continue;
    if (found.some((entry) => entry.source === total.source && entry.kind === "TOTAL")) continue;

    found.push({
      source: total.source,
      kind: "TOTAL",
      label: `${possessive(SOURCE_LABEL[total.source])} total amount does not match`,
      detail: `${SOURCE_LABEL[total.source]} shows ${money(total.amount)}, but ${money(
        investment.amount,
      )} invested${fee ? ` plus ${money(fee.amount)} of fees` : ""} comes to ${money(expected)}.`,
    });
  }

  return found;
}

export function needsReview(claims: Claim[]): boolean {
  return findDiscrepancies(claims).length > 0;
}
