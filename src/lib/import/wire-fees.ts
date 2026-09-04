import "server-only";
import { prisma } from "@/lib/prisma";
import { recordClaim } from "@/lib/claims";
import { matchCompanyByContent } from "@/lib/gmail/content-match";
import { closestByDate, type RecordedPosition } from "@/lib/reconcile";
import { parseWireTable } from "./wire-table";

// Filing the fee a syndicate's wire instructions state.
//
// Fees were only ever recovered from a bank transfer, as the excess of the wire
// over the commitment. That works, but only once the money has moved and only
// when the bank's own mail is in the mailbox, so a position waiting on a wire
// showed a fee of zero and read as a cleaner deal than it is. The wire
// instructions state it exactly, weeks earlier, in the reader's own row.
//
// This never overwrites: a fee already on the ledger stands, and a wire table
// that disagrees with it becomes a claim, which surfaces as "Needs Review"
// rather than silently changing a number.

export interface WireFeeResult {
  /// Emails that carried a readable table.
  tables: number;
  /// Fees written to the ledger, which excludes positions that already had one.
  feesRecorded: number;
  /// Tables read but not attributable to a position.
  unmatched: number;
}

function toNumber(value: unknown): number {
  if (value == null) return 0;
  return typeof value === "number" ? value : Number(value.toString());
}

/// How the reader's own row is recognised in a table listing several people.
/// The name comes from their own sent mail; the address is the fallback, since
/// some tables carry an email column instead.
async function readerNames(userId: string): Promise<string[]> {
  const account = await prisma.gmailAccount.findUnique({
    where: { userId },
    select: { emailAddress: true },
  });
  if (!account) return [];

  const own = await prisma.update.findFirst({
    where: { userId, fromAddress: { equals: account.emailAddress, mode: "insensitive" } },
    select: { fromName: true },
  });

  return [own?.fromName, account.emailAddress].filter((name): name is string => !!name);
}

export async function recordWireInstructionFees(userId: string): Promise<WireFeeResult> {
  const [updates, companies, names] = await Promise.all([
    // "Commitment" appears in every table header and in little else, so this
    // keeps the scan to a handful of emails rather than the whole mailbox.
    prisma.update.findMany({
      where: { userId, rawText: { contains: "Commitment", mode: "insensitive" } },
      select: {
        id: true,
        companyId: true,
        subject: true,
        rawText: true,
        receivedAt: true,
      },
      orderBy: { receivedAt: "asc" },
    }),
    prisma.company.findMany({ where: { userId }, select: { id: true, name: true } }),
    readerNames(userId),
  ]);

  const named = companies.map((company) => ({ companyId: company.id, name: company.name }));
  const result: WireFeeResult = { tables: 0, feesRecorded: 0, unmatched: 0 };

  for (const update of updates) {
    const table = parseWireTable(update.rawText, names);
    if (!table) continue;
    result.tables += 1;

    // A syndicate sends wire instructions from its own address, so the company
    // is whatever the email names, exactly as for a bank confirmation.
    let companyId = update.companyId;
    if (!companyId) {
      const match = matchCompanyByContent(update.rawText, named, { subject: update.subject });
      if (match && match.confidence >= 0.8) companyId = match.companyId;
    }
    if (!companyId) {
      result.unmatched += 1;
      continue;
    }

    const rows = await prisma.position.findMany({
      where: { userId, companyId },
      include: { transactions: true },
    });
    const positions: RecordedPosition[] = rows.map((row) => ({
      id: row.id,
      invested: row.transactions
        .filter((t) => t.kind === "INVESTMENT" || t.kind === "CAPITAL_CALL")
        .reduce((total, t) => total + toNumber(t.amount), 0),
      fees: row.transactions
        .filter((t) => t.kind === "FEE")
        .reduce((total, t) => total + toNumber(t.amount), 0),
      investmentDate: row.investmentDate,
    }));

    const position = closestByDate(positions, update.receivedAt);
    if (!position) {
      result.unmatched += 1;
      continue;
    }

    // Recorded whatever the ledger says, so a disagreement has a source to
    // name. The claims are keyed by source and kind, so a re-run replaces them
    // rather than piling up.
    //
    // The total is deliberately not claimed. It carries nothing the other two
    // do not, since the row was only accepted because it adds up, and it is the
    // part that goes stale: a waived admin fee leaves the schedule's total
    // wrong while its commitment and fee breakdown stay useful.
    for (const [kind, amount] of [
      ["INVESTMENT", table.commitment],
      ["FEE", table.fees],
    ] as const) {
      await recordClaim({
        userId,
        companyId,
        positionId: position.id,
        source: "WIRE_INSTRUCTION",
        kind,
        amount,
        sourceQuote: table.sourceQuote,
        updateId: update.id,
      });
    }

    // Fill, never overwrite. A fee already on the ledger came from the bank or
    // from the user, and both outrank a schedule of what was going to be owed.
    if (position.fees > 0 || table.fees <= 0) continue;

    await prisma.transaction.create({
      data: {
        userId,
        positionId: position.id,
        kind: "FEE",
        amount: table.fees,
        date: update.receivedAt,
        notes: `From the wire instructions: ${table.sourceQuote}`,
      },
    });
    result.feesRecorded += 1;
  }

  return result;
}
