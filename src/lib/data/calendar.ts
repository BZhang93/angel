import "server-only";
import { prisma } from "@/lib/prisma";
import { addYears, daysBetween } from "@/lib/signals";

// Every date that has money or a decision attached to it, in one list. These
// live in four different tables, which is exactly why they get missed.

export type KeyDateKind = "QSBS" | "MATURITY" | "ACTION" | "LOCKUP";

export interface KeyDate {
  kind: KeyDateKind;
  date: Date;
  daysAway: number;
  companyId: string;
  companyName: string;
  label: string;
  detail?: string;
  /// Set only for ACTION, the one kind a person can clear.
  actionItemId?: string;
}

export async function getKeyDates(
  userId: string,
  opts: { asOf?: Date; horizonDays?: number } = {},
): Promise<KeyDate[]> {
  const asOf = opts.asOf ?? new Date();
  const horizonDays = opts.horizonDays ?? 730;

  const [positions, actions] = await Promise.all([
    prisma.position.findMany({
      where: { userId, convertedIntoId: null },
      include: { company: { select: { id: true, name: true } } },
    }),
    prisma.actionItem.findMany({
      where: { userId, state: "OPEN", dueDate: { not: null } },
      include: { company: { select: { id: true, name: true } } },
    }),
  ]);

  const dates: KeyDate[] = [];

  for (const position of positions) {
    if (position.qsbsEligible) {
      const date = addYears(position.investmentDate, 5);
      dates.push({
        kind: "QSBS",
        date,
        daysAway: daysBetween(asOf, date),
        companyId: position.company.id,
        companyName: position.company.name,
        label: "QSBS five-year date",
        detail: "Selling before this date forfeits the §1202 exclusion.",
      });
    }
    if (position.maturityDate) {
      dates.push({
        kind: "MATURITY",
        date: position.maturityDate,
        daysAway: daysBetween(asOf, position.maturityDate),
        companyId: position.company.id,
        companyName: position.company.name,
        label: "Note matures",
      });
    }
  }

  for (const action of actions) {
    dates.push({
      kind: "ACTION",
      date: action.dueDate!,
      daysAway: daysBetween(asOf, action.dueDate!),
      companyId: action.company.id,
      companyName: action.company.name,
      label: action.title,
      detail: action.detail ?? undefined,
      // Carried so the dashboard can clear the thing it is showing. An action
      // item is the only kind a person can act on: a QSBS date is a fact about
      // the calendar, not a task.
      actionItemId: action.id,
    });
  }

  // Overdue items are kept here and sorted out by the caller: /calendar wants
  // the whole record, and the dashboard wants only what is still worth doing.
  // See shapeKeyDates, which decides how overdue is too overdue.
  return dates
    .filter((entry) => entry.daysAway <= horizonDays)
    .sort((a, b) => a.date.getTime() - b.date.getTime());
}
