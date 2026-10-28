"use client";

import { useState } from "react";
import Link from "next/link";
import { dismissActionItem, dismissStaleActionItems } from "@/app/(app)/companies/actions";
import { Card } from "@/components/ui";

export interface CardDate {
  kind: string;
  dateLabel: string;
  relative: string;
  companyId: string;
  companyName: string;
  label: string;
  actionItemId?: string;
}

/// The dashboard's calendar card.
///
/// Two lists rather than one, because "what is coming" and "what was missed"
/// are different questions and merging them let the second bury the first.
/// Clearing happens here too: the card used to be able to tell you about a
/// reminder but not to let you be rid of it, so the only way to empty it was
/// to visit each company in turn.
export function KeyDatesCard({
  upcoming,
  overdue,
  staleCount,
  hidden,
  horizonDays,
}: {
  upcoming: CardDate[];
  overdue: CardDate[];
  staleCount: number;
  hidden: number;
  horizonDays: number;
}) {
  const [message, setMessage] = useState<string | null>(null);
  const [clearing, setClearing] = useState(false);

  async function clearStale() {
    setClearing(true);
    const result = await dismissStaleActionItems();
    setClearing(false);
    setMessage(result.message);
  }

  const empty = upcoming.length === 0 && overdue.length === 0;

  return (
    <Card title={`Next ${horizonDays} Days`}>
      {empty ? (
        <p className="py-4 text-sm text-muted">
          Nothing due in the next {Math.round(horizonDays / 30)} months.
          {staleCount > 0 && " Everything dated is already past."}
        </p>
      ) : (
        <div className="space-y-3">
          {overdue.length > 0 && (
            <Section title="Missed recently" items={overdue} tone="negative" />
          )}
          {upcoming.length > 0 && <Section title="Coming up" items={upcoming} tone="muted" />}
        </div>
      )}

      {(staleCount > 0 || hidden > 0) && (
        <div className="mt-3 space-y-1 border-t border-border pt-3 text-xs text-muted">
          {hidden > 0 && (
            <p>
              {hidden} more inside the window, not shown.{" "}
              <Link href="/calendar" className="underline">
                See the calendar
              </Link>
            </p>
          )}
          {staleCount > 0 && (
            <p>
              {/* Named rather than silently dropped. An invisible pile is how
                  the old card filled up with reminders from last May. */}
              {staleCount} reminder{staleCount === 1 ? "" : "s"} more than a month past their date,
              left out.{" "}
              <button type="button" className="underline" disabled={clearing} onClick={clearStale}>
                {clearing ? "Clearing…" : "Clear them"}
              </button>
            </p>
          )}
          {message && <p className="text-foreground">{message}</p>}
        </div>
      )}
    </Card>
  );
}

function Section({
  title,
  items,
  tone,
}: {
  title: string;
  items: CardDate[];
  tone: "negative" | "muted";
}) {
  return (
    <div>
      <p className={`text-xs font-medium ${tone === "negative" ? "text-negative" : "text-muted"}`}>
        {title}
      </p>
      <ul className="divide-y divide-border">
        {items.map((entry, index) => (
          <li
            key={`${entry.companyId}-${entry.kind}-${index}`}
            className="flex items-baseline justify-between gap-3 py-2"
          >
            <div className="min-w-0">
              <Link
                href={`/companies/${entry.companyId}`}
                className="text-sm font-medium hover:underline"
              >
                {entry.companyName}
              </Link>
              <p className="truncate text-sm text-muted">{entry.label}</p>
            </div>
            <div className="tabular shrink-0 text-right text-xs text-muted">
              <div>{entry.dateLabel}</div>
              <div>{entry.relative}</div>
              {/* Only an action item can be cleared. A QSBS five-year date is
                  a fact about the calendar and dismissing it would be a lie. */}
              {entry.actionItemId && (
                <form action={dismissActionItem}>
                  <input type="hidden" name="id" value={entry.actionItemId} />
                  <button type="submit" className="underline">
                    Clear
                  </button>
                </form>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
