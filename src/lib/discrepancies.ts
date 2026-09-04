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

function money(value: number): string {
  return `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/// The value the portfolio treats as true for a kind: whatever the user entered
/// if they entered one, else the most trustworthy source that stated it.
/// Most trusted first. The investor's own statements outrank anything a third
/// party said about the deal: what they typed into the app, then the signed
/// document, then their own commitment email. A syndicate's confirmation and a
/// bank's gross figure are evidence, but they describe the round or the wire
/// rather than what was committed.
const TRUST_ORDER: ClaimSource[] = [
  "MANUAL",
  "DOCUSIGN",
  "DOCUMENT",
  "EMAIL_COMMITMENT",
  "BANK_TRANSFER",
  "EMAIL_CONFIRMATION",
];

export function agreedValue(claims: Claim[], kind: ClaimKind): Claim | null {
  const relevant = claims.filter((claim) => claim.kind === kind);
  if (relevant.length === 0) return null;

  for (const source of TRUST_ORDER) {
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
        label: `${SOURCE_LABEL[claim.source]}'s ${KIND_LABEL[kind]} does not match`,
        detail: `${SOURCE_LABEL[claim.source]} says ${money(claim.amount)}; ${SOURCE_LABEL[
          agreed.source
        ].toLowerCase()} says ${money(agreed.amount)}.`,
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
      label: `${SOURCE_LABEL[total.source]}'s total amount does not match`,
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
