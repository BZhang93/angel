"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { confirmUpdates, rejectUpdates, restoreUpdates } from "./actions";
import { CONTROL_PRIMARY, CONTROL_SECONDARY } from "@/components/ui";

// Selection for the whole review queue, not one group of it.
//
// It has to live above the groups for the toolbar to float: a bar fixed to the
// window is a single thing, and per-group state would put two of them on screen
// the moment someone selected rows in two companies. Lifting it also makes the
// useful case possible, selecting across groups and filing the lot in one go.

interface SelectionState {
  /// Update id to the company its group suggested, which is what lets the bar
  /// preselect a company when everything chosen agrees on one.
  selected: Map<string, string | null>;
  toggle: (id: string, suggestedCompanyId: string | null) => void;
  setMany: (entries: [string, string | null][], on: boolean) => void;
  clear: () => void;
}

const SelectionContext = createContext<SelectionState | null>(null);

export function useReviewSelection(): SelectionState {
  const context = useContext(SelectionContext);
  if (!context) throw new Error("useReviewSelection used outside ReviewSelectionProvider");
  return context;
}

export function ReviewSelectionProvider({
  companies,
  children,
}: {
  companies: { id: string; name: string }[];
  children: ReactNode;
}) {
  const [selected, setSelected] = useState<Map<string, string | null>>(new Map());

  const value = useMemo<SelectionState>(
    () => ({
      selected,
      toggle: (id, suggestedCompanyId) =>
        setSelected((current) => {
          const next = new Map(current);
          if (next.has(id)) next.delete(id);
          else next.set(id, suggestedCompanyId);
          return next;
        }),
      setMany: (entries, on) =>
        setSelected((current) => {
          const next = new Map(current);
          for (const [id, companyId] of entries) {
            if (on) next.set(id, companyId);
            else next.delete(id);
          }
          return next;
        }),
      clear: () => setSelected(new Map()),
    }),
    [selected],
  );

  return (
    <SelectionContext.Provider value={value}>
      {children}
      <SelectionBar companies={companies} />
    </SelectionContext.Provider>
  );
}

/// The toolbar itself, fixed to the bottom of the window so a decision is
/// always one reach away however far down the queue you have scrolled.
function SelectionBar({ companies }: { companies: { id: string; name: string }[] }) {
  const { selected, clear } = useReviewSelection();
  const [override, setOverride] = useState<string | null>(null);
  const [pending, setPending] = useState<"assign" | "clear" | "undo" | null>(null);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [undoIds, setUndoIds] = useState<string[] | null>(null);

  const ids = [...selected.keys()];
  const count = ids.length;

  // When everything selected came from one company's group, that company is
  // almost certainly the answer, so the picker starts there. A mixed selection
  // starts empty rather than guessing at one of them.
  const suggestions = new Set(selected.values());
  const common = suggestions.size === 1 ? ([...suggestions][0] ?? "") : "";
  const target = override ?? common ?? "";

  async function assign() {
    if (!target) {
      setMessage({ tone: "error", text: "Choose a company first." });
      return;
    }
    setPending("assign");
    const result = await confirmUpdates(ids, target);
    setPending(null);
    if (!result) return;
    setMessage({ tone: result.status === "ok" ? "ok" : "error", text: result.message });
    if (result.status === "ok") {
      clear();
      setOverride(null);
      setUndoIds(null);
    }
  }

  async function reject() {
    setPending("clear");
    const result = await rejectUpdates(ids);
    setPending(null);
    setMessage({ tone: result.status === "ok" ? "ok" : "error", text: result.message });
    if (result.status === "ok") {
      clear();
      setUndoIds(result.undoIds ?? null);
    }
  }

  async function undo() {
    if (!undoIds) return;
    setPending("undo");
    const result = await restoreUpdates(undoIds);
    setPending(null);
    setMessage({ tone: result.status === "ok" ? "ok" : "error", text: result.message });
    if (result.status === "ok") setUndoIds(null);
  }

  // Nothing selected and nothing to say: the bar is not on screen at all, so
  // it never covers the last row of a queue being read rather than worked.
  if (count === 0 && !message) return null;

  return (
    <div
      role="region"
      aria-label="Bulk actions for selected updates"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface/95 backdrop-blur"
    >
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-2 px-6 py-3">
        {count > 0 ? (
          <>
            <span aria-live="polite" className="text-sm font-medium">
              {count} selected
            </span>
            <button type="button" className="text-xs text-muted underline" onClick={clear}>
              Clear selection
            </button>
            <div className="flex-1" />
            <select
              value={target}
              onChange={(event) => setOverride(event.target.value)}
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
              onClick={assign}
            >
              {pending === "assign" ? "Assigning…" : `Assign ${count}`}
            </button>
            <button
              type="button"
              className={CONTROL_SECONDARY}
              disabled={pending != null}
              onClick={reject}
            >
              {pending === "clear" ? "Clearing…" : `Not Updates (${count})`}
            </button>
          </>
        ) : (
          <>
            {/* The bar outlives the selection by one action, so the result of
                what just happened, and the undo for it, do not vanish with
                the rows they describe. */}
            <span className={`text-sm ${message?.tone === "error" ? "text-negative" : ""}`}>
              {message?.text}
            </span>
            {undoIds && undoIds.length > 0 && (
              <button
                type="button"
                className="text-sm underline"
                disabled={pending != null}
                onClick={undo}
              >
                {pending === "undo" ? "Restoring…" : "Undo"}
              </button>
            )}
            <div className="flex-1" />
            <button
              type="button"
              className="text-xs text-muted underline"
              onClick={() => {
                setMessage(null);
                setUndoIds(null);
              }}
            >
              Dismiss
            </button>
          </>
        )}
      </div>
    </div>
  );
}
