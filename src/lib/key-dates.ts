// Shaping the dashboard's calendar card.
//
// Pure, because the judgements here are the whole value of the card and they
// are all arguable: how overdue is too overdue to matter, how many rows one
// company may occupy, and whether a date in the past belongs on a card titled
// with the future.
//
// The card it replaces answered those by accident. Every item it showed was in
// the past, six of eight came from one company, and the oldest was 171 days
// overdue: a reminder to attend a live Q&A last May, still being advertised as
// something to do in the next six months.

export interface DatedItem {
  kind: string;
  date: Date;
  daysAway: number;
  companyId: string;
  companyName: string;
  label: string;
  detail?: string;
  /// Present for an action item, which is the only kind a person can clear. A
  /// QSBS date is a fact about the calendar, not a task.
  actionItemId?: string;
}

export interface ShapedKeyDates {
  /// Due now or later, soonest first. What the card is actually for.
  upcoming: DatedItem[];
  /// Recently missed, and still worth acting on. Most recent first, because the
  /// freshest miss is the one still worth chasing.
  overdue: DatedItem[];
  /// Long past: shown nowhere on the card, but counted, because an invisible
  /// pile the user cannot see is how the old card filled up unnoticed.
  stale: DatedItem[];
  /// Rows trimmed by the per-company cap or the row limit, so the card can say
  /// how much it is not showing instead of implying there is no more.
  hidden: number;
}

export interface ShapeOptions {
  /// How long a missed date stays worth chasing. A month is the judgement: a
  /// wire deadline missed last week is live, and a Q&A from May is history.
  staleAfterDays?: number;
  /// Most rows one company may take in either list. Without this, a company
  /// whose extraction produced six near-identical asks owns the whole card.
  perCompany?: number;
  /// Rows per list.
  limit?: number;
}

function capPerCompany(items: DatedItem[], perCompany: number): { kept: DatedItem[]; dropped: number } {
  const seen = new Map<string, number>();
  const kept: DatedItem[] = [];
  let dropped = 0;
  for (const item of items) {
    const count = seen.get(item.companyId) ?? 0;
    if (count >= perCompany) {
      dropped += 1;
      continue;
    }
    seen.set(item.companyId, count + 1);
    kept.push(item);
  }
  return { kept, dropped };
}

export function shapeKeyDates(items: DatedItem[], opts: ShapeOptions = {}): ShapedKeyDates {
  const staleAfterDays = opts.staleAfterDays ?? 30;
  const perCompany = opts.perCompany ?? 2;
  const limit = opts.limit ?? 5;

  const stale = items
    .filter((item) => item.daysAway < -staleAfterDays)
    .sort((a, b) => a.date.getTime() - b.date.getTime());

  // Soonest first: the next thing to do is the top row.
  const upcomingAll = items
    .filter((item) => item.daysAway >= 0)
    .sort((a, b) => a.date.getTime() - b.date.getTime());

  // Most recent first: a miss from yesterday outranks one from three weeks ago.
  const overdueAll = items
    .filter((item) => item.daysAway < 0 && item.daysAway >= -staleAfterDays)
    .sort((a, b) => b.date.getTime() - a.date.getTime());

  const upcoming = capPerCompany(upcomingAll, perCompany);
  const overdue = capPerCompany(overdueAll, perCompany);

  const hidden =
    upcoming.dropped +
    overdue.dropped +
    Math.max(0, upcoming.kept.length - limit) +
    Math.max(0, overdue.kept.length - limit);

  return {
    upcoming: upcoming.kept.slice(0, limit),
    overdue: overdue.kept.slice(0, limit),
    stale,
    hidden,
  };
}
