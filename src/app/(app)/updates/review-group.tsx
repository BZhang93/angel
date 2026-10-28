"use client";

import type { ReactNode } from "react";
import { CONTROL_SECONDARY } from "@/components/ui";
import { useReviewSelection } from "./review-selection";

export interface GroupItem {
  id: string;
  render: ReactNode;
}

/// A company's share of the review queue.
///
/// The group owns which rows it offers and the convenience of selecting all of
/// them; it does not own the selection. That lives on the page, because the
/// toolbar is fixed to the window and there can only be one of those. Selecting
/// across two companies and filing them separately is then possible, where
/// per-group state made it two separate chores.
///
/// Selection is React state rather than form fields: each row already carries
/// its own form for the individual assign and reject, and forms cannot nest.
export function ReviewGroup({
  companyId,
  companyName,
  items,
}: {
  companyId: string | null;
  companyName: string | null;
  items: GroupItem[];
}) {
  const { selected, toggle, setMany } = useReviewSelection();

  const entries = items.map((item) => [item.id, companyId] as [string, string | null]);
  const allSelected = items.length > 0 && items.every((item) => selected.has(item.id));

  return (
    <section className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">
          {companyName ?? "Unassigned"}{" "}
          <span className="font-normal text-muted">
            ({items.length} update{items.length === 1 ? "" : "s"})
          </span>
        </h2>

        <button
          type="button"
          className={CONTROL_SECONDARY}
          onClick={() => setMany(entries, !allSelected)}
        >
          {allSelected ? "Select None" : "Select All"}
        </button>
      </div>

      <div className="space-y-3">
        {items.map((item) => (
          <div key={item.id} className="flex gap-3">
            <input
              type="checkbox"
              className="mt-4 size-4 shrink-0"
              checked={selected.has(item.id)}
              onChange={() => toggle(item.id, companyId)}
              aria-label="Select this update"
            />
            <div className="min-w-0 flex-1">{item.render}</div>
          </div>
        ))}
      </div>
    </section>
  );
}
