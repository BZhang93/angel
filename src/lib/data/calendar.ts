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
    });
  }

  // Overdue items stay visible: a missed pro-rata deadline is still worth
  // knowing about. Only the far future is trimmed.
  return dates
    .filter((entry) => entry.daysAway <= horizonDays)
    .sort((a, b) => a.date.getTime() - b.date.getTime());
}
