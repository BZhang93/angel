"use client";

import { useState, type ReactNode } from "react";
import { confirmUpdates, rejectUpdates, restoreUpdates } from "./actions";
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
///
/// Every group gets selection, including Unassigned. That group used to be the
/// exception, on the reasoning that there was no company to confirm against,
/// which left the largest group in the queue as the only one with no bulk
/// anything: the rows most needing a decision were the rows you had to click
/// one at a time. A picker supplies the company instead.
export function ReviewGroup({
  companyId,
  companyName,
  companies,
  items,
}: {
  companyId: string | null;
  companyName: string | null;
  companies: { id: string; name: string }[];
  items: GroupItem[];
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [target, setTarget] = useState<string>(companyId ?? "");
  const [pending, setPending] = useState<"assign" | "clear" | "undo" | null>(null);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [undoIds, setUndoIds] = useState<string[] | null>(null);

  const allSelected = items.length > 0 && selected.size === items.length;
  const count = selected.size;

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  /// Rows that succeeded are gone on revalidation, so the selection is cleared
  /// rather than carrying ids that no longer exist into the next action.
  function settle(result: { status: "ok" | "error"; message: string; undoIds?: string[] }) {
    setMessage({ tone: result.status === "ok" ? "ok" : "error", text: result.message });
    if (result.status === "ok") {
      setSelected(new Set());
      setUndoIds(result.undoIds ?? null);
    }
  }

  async function assignSelected() {
    if (!target) {
      setMessage({ tone: "error", text: "Choose a company first." });
      return;
    }
    setPending("assign");
    const result = await confirmUpdates([...selected], target);
    setPending(null);
    if (result) settle(result);
  }

  async function clearSelected() {
    setPending("clear");
    const result = await rejectUpdates([...selected]);
    setPending(null);
    settle(result);
  }

  async function undoClear() {
    if (!undoIds) return;
    setPending("undo");
    const result = await restoreUpdates(undoIds);
    setPending(null);
    setMessage({ tone: result.status === "ok" ? "ok" : "error", text: result.message });
    if (result.status === "ok") setUndoIds(null);
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

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className={CONTROL_SECONDARY}
            onClick={() => setSelected(allSelected ? new Set() : new Set(items.map((i) => i.id)))}
          >
            {allSelected ? "Select None" : "Select All"}
          </button>

          {/* Shown only with a selection: a picker and two verbs on a group
              nobody has selected anything in is just noise. */}
          {count > 0 && (
            <>
              <select
                value={target}
                onChange={(event) => setTarget(event.target.value)}
                className={CONTROL_SECONDARY}
                aria-label="Company to assign the selected updates to"
              >
                <option value="">Choose a company…</option>
                {companies.map((company) => (
                  <option key={company.id} value={company.id}>
                    {company.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className={CONTROL_PRIMARY}
                disabled={pending != null}
                onClick={assignSelected}
              >
                {pending === "assign" ? "Assigning…" : `Assign ${count}`}
              </button>
              <button
                type="button"
                className={CONTROL_SECONDARY}
                disabled={pending != null}
                onClick={clearSelected}
              >
                {pending === "clear" ? "Clearing…" : `Not Updates (${count})`}
              </button>
            </>
          )}
        </div>
      </div>

      {message && (
        <p className={`text-sm ${message.tone === "ok" ? "text-muted" : "text-negative"}`}>
          {message.text}{" "}
          {/* Clearing is the one bulk action with nothing else to undo it, so
              the undo lives next to the confirmation rather than in a menu. */}
          {undoIds && undoIds.length > 0 && (
            <button
              type="button"
              className="underline"
              disabled={pending != null}
              onClick={undoClear}
            >
              {pending === "undo" ? "Restoring…" : "Undo"}
            </button>
          )}
        </p>
      )}

      <div className="space-y-3">
        {items.map((item) => (
          <div key={item.id} className="flex gap-3">
            <input
              type="checkbox"
              className="mt-4 size-4 shrink-0"
              checked={selected.has(item.id)}
              onChange={() => toggle(item.id)}
              aria-label="Select this update"
            />
            <div className="min-w-0 flex-1">{item.render}</div>
          </div>
        ))}
      </div>
    </section>
  );
}
