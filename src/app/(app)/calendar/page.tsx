import Link from "next/link";
import { Card, EmptyState, Pill } from "@/components/ui";
import { getKeyDates, type KeyDate } from "@/lib/data/calendar";
import { relativeDays, shortDate } from "@/lib/format";
import { requireUserId } from "@/lib/session";

const KIND_LABEL: Record<KeyDate["kind"], string> = {
  QSBS: "QSBS",
  MATURITY: "Maturity",
  ACTION: "Action",
  LOCKUP: "Lockup",
};

export default async function CalendarPage() {
  const userId = await requireUserId();
  const dates = await getKeyDates(userId);

  if (dates.length === 0) {
    return (
      <EmptyState
        title="No Dates on File"
        body="Note maturities, QSBS five-year dates and action item deadlines appear here as soon as they exist."
      />
    );
  }

  const overdue = dates.filter((entry) => entry.daysAway < 0);
  const upcoming = dates.filter((entry) => entry.daysAway >= 0);

  return (
    <div className="space-y-6">
      <h1 className="text-lg font-semibold">Key Dates</h1>

      {overdue.length > 0 && (
        <Card title="Overdue">
          <DateList entries={overdue} />
        </Card>
      )}

      <Card title="Upcoming">
        <DateList entries={upcoming} />
      </Card>
    </div>
  );
}

function DateList({ entries }: { entries: KeyDate[] }) {
  return (
    <ul className="divide-y divide-border">
      {entries.map((entry, index) => (
        <li
          key={`${entry.companyId}-${entry.kind}-${index}`}
          className="flex items-baseline justify-between gap-3 py-2"
        >
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Link href={`/companies/${entry.companyId}`} className="text-sm font-medium hover:underline">
                {entry.companyName}
              </Link>
              <Pill>{KIND_LABEL[entry.kind]}</Pill>
            </div>
            <p className="text-sm text-muted">{entry.label}</p>
            {entry.detail && <p className="text-xs text-muted">{entry.detail}</p>}
          </div>
          <div className="tabular shrink-0 text-right text-xs text-muted">
            <div>{shortDate(entry.date)}</div>
            <div className={entry.daysAway < 0 ? "text-negative" : ""}>
              {relativeDays(entry.daysAway)}
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}
