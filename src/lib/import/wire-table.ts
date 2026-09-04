// Reading the fee table out of a syndicate's wire instructions.
//
// This is the only place the investor's own fee is ever stated exactly. The
// commitment comes from their reply ("in for 3k"), and the bank confirms a
// gross figure weeks later, but the split between the two lives in one
// personalised table:
//
//   Name Commitment Legal Fees Admin Fees Total (USD)
//   Bryan Zhang $2,000 $189 0 $2,189
//
// Leaving this to the model lost it every time: the table sits in one batch of
// a long sender thread and reads as boilerplate, so seven imports produced one
// fee. Deriving the fee from a bank transfer instead only works for deals that
// have already been wired, which is why a position with no bank email showed no
// fee at all.
//
// Pure and tested: this decides money that goes into the ledger.

export interface WireTable {
  /// The reader's own commitment, fees excluded.
  commitment: number;
  /// Legal and admin fees combined, which is what the ledger records.
  fees: number;
  /// What has to leave the account: commitment plus fees.
  total: number;
  /// The row it came from, kept as provenance.
  sourceQuote: string;
}

type Column = "commitment" | "fee" | "total";

/// Where each money column sits in the header, in the order it appears. Only
/// the labels that carry a number are listed: "Name" and "Email Address" are
/// deliberately absent, since a row may or may not restate them.
const COLUMN_PATTERNS: Array<{ column: Column; pattern: RegExp }> = [
  { column: "commitment", pattern: /commitment/i },
  { column: "fee", pattern: /legal\s*fees?/i },
  { column: "fee", pattern: /admin(?:istrative)?\s*fees?/i },
  { column: "total", pattern: /total/i },
];

const MONEY = /(?<![\w.])\$?\d[\d,]*(?:\.\d+)?/g;

/// A fee far above this is not a fee. Viaka's run 3-10%; a mis-read row that
/// took a round size for a fee would sail past a looser bound.
const MAX_FEE_RATIO = 0.5;

/// Cents. Banks and spreadsheets round differently.
const TOLERANCE = 0.02;

function columnsOf(header: string): Column[] {
  const found: Array<{ column: Column; at: number }> = [];
  for (const { column, pattern } of COLUMN_PATTERNS) {
    const match = pattern.exec(header);
    if (match) found.push({ column, at: match.index });
  }
  return found.sort((a, b) => a.at - b.at).map((entry) => entry.column);
}

function numbersIn(line: string): number[] {
  const values: number[] = [];
  for (const token of line.match(MONEY) ?? []) {
    const value = Number(token.replace(/[$,]/g, ""));
    if (Number.isFinite(value)) values.push(value);
  }
  return values;
}

/// True for a header naming both what was committed and what it adds up to.
/// Prose that happens to mention a commitment is not a table.
function isHeader(line: string): boolean {
  const columns = columnsOf(line);
  return (
    columns.length >= 2 &&
    columns.includes("commitment") &&
    columns[columns.length - 1] === "total" &&
    numbersIn(line).length === 0
  );
}

/// Pulls the reader's row out of a wire-instructions email.
///
/// `investorNames` disambiguates a table listing several investors. A
/// personalised table has one row and needs no hint, which is the common case.
export function parseWireTable(text: string, investorNames: string[] = []): WireTable | null {
  const lines = text.split(/\r?\n/);

  for (const [index, line] of lines.entries()) {
    if (!isHeader(line)) continue;
    const columns = columnsOf(line);

    // The row follows the header, though not always immediately: a wrapped
    // table can put the email address on its own line first.
    const rows = lines
      .slice(index + 1, index + 7)
      .filter((candidate) => numbersIn(candidate).length >= 2);
    if (rows.length === 0) continue;

    const named = rows.filter((row) =>
      investorNames.some((name) => name && row.toLowerCase().includes(name.toLowerCase())),
    );
    // Several rows and no way to tell which is the reader's: guessing here
    // would record another investor's cheque.
    if (rows.length > 1 && named.length !== 1) continue;
    const row = named[0] ?? rows[0]!;

    const parsed = readRow(columns, numbersIn(row));
    if (parsed) return { ...parsed, sourceQuote: row.trim() };
  }

  return null;
}

function readRow(columns: Column[], values: number[]): Omit<WireTable, "sourceQuote"> | null {
  if (values.length < 2 || values.length > columns.length) return null;

  let commitment: number;
  let total: number;

  if (values.length === columns.length) {
    const commitmentAt = columns.indexOf("commitment");
    commitment = values[commitmentAt]!;
    total = values[values.length - 1]!;
  } else {
    // Fewer numbers than columns: a zero fee was left blank rather than
    // written as 0. The ends are still the ends, so the middle is fees.
    commitment = values[0]!;
    total = values[values.length - 1]!;
  }

  const fees = round2(total - commitment);

  // The row has to add up. This is the whole safety net: a misread table
  // almost never balances, and one that does is right whatever it looked like.
  const stated = values.slice(0, -1).reduce((sum, value) => sum + value, 0);
  if (Math.abs(stated - total) > TOLERANCE) return null;

  if (commitment <= 0 || total <= 0 || fees < 0) return null;
  if (fees > commitment * MAX_FEE_RATIO) return null;

  return { commitment: round2(commitment), fees, total: round2(total) };
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
