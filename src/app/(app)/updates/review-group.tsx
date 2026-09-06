"use client";

import { useState, type ReactNode } from "react";
import { confirmUpdates } from "./actions";
import { CONTROL_PRIMARY, CONTROL_SECONDARY } from "@/components/ui";

export interface GroupItem {
  id: string;
  render: ReactNode;
}

/// A company's share of the review queue, with the selection state that makes
/// one decision cover all of it.
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
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  const allSelected = items.length > 0 && selected.size === items.length;
  // Nothing to confirm against: the unassigned group keeps the per-row flow.
  const bulk = companyId != null;

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function confirmSelected() {
    if (!companyId) return;
    setPending(true);
    const result = await confirmUpdates([...selected], companyId);
    setPending(false);
    if (result) setMessage({ tone: result.status === "ok" ? "ok" : "error", text: result.message });
    // Rows that succeeded are gone on revalidation; clearing avoids carrying a
    // selection of ids that no longer exist into the next action.
    if (result?.status === "ok") setSelected(new Set());
  }

  return (
    <section className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">
          {companyName ?? "Unassigned"}{" "}
          <span className="font-normal text-muted">
            ({items.length} update{items.length === 1 ? "" : "s"})
          </span>
        </h2>

        {bulk && (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className={CONTROL_SECONDARY}
              onClick={() => setSelected(allSelected ? new Set() : new Set(items.map((i) => i.id)))}
            >
              {allSelected ? "Select None" : "Select All"}
            </button>
            <button
              type="button"
              className={CONTROL_PRIMARY}
              disabled={pending || selected.size === 0}
              onClick={confirmSelected}
            >
              {pending
                ? "Assigning…"
                : `Confirm Selected${selected.size > 0 ? ` (${selected.size})` : ""}`}
            </button>
          </div>
        )}
      </div>

      {message && (
        <p className={`text-sm ${message.tone === "ok" ? "text-muted" : "text-negative"}`}>
          {message.text}
        </p>
      )}

      <div className="space-y-3">
        {items.map((item) => (
          <div key={item.id} className="flex gap-3">
            {bulk && (
              <input
                type="checkbox"
                className="mt-4 size-4 shrink-0"
                checked={selected.has(item.id)}
                onChange={() => toggle(item.id)}
                aria-label="Select this update"
              />
            )}
            <div className="min-w-0 flex-1">{item.render}</div>
          </div>
        ))}
      </div>
    </section>
  );
}
