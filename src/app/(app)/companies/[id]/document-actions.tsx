"use client";

import { useState } from "react";
import { CONTROL_SECONDARY } from "@/components/ui";
import { deleteDocument, rereadDocument } from "../actions";

/// Re-read and delete for one stored document. Re-read matters for anything
/// filed before the extractor learned to use what it found; delete removes the
/// file and its record, and deliberately leaves behind any position or amount
/// the document already contributed.
export function DocumentActions({ id, canReread }: { id: string; canReread: boolean }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<"read" | "delete" | null>(null);

  async function run(kind: "read" | "delete", action: (form: FormData) => Promise<unknown>) {
    if (kind === "delete" && !confirm("Delete this document? The file is removed for good.")) return;
    const form = new FormData();
    form.set("id", id);
    setPending(kind);
    const result = (await action(form)) as { status: "error"; message: string } | undefined;
    setError(result?.status === "error" ? result.message : null);
    setPending(null);
  }

  return (
    <div className="flex shrink-0 items-center gap-2">
      {error && <span className="text-xs text-negative">{error}</span>}
      {canReread && (
        <button
          type="button"
          disabled={pending !== null}
          onClick={() => run("read", rereadDocument)}
          className={`${CONTROL_SECONDARY} px-2 py-1 text-xs`}
        >
          {pending === "read" ? "Reading…" : "Re-read"}
        </button>
      )}
      <button
        type="button"
        disabled={pending !== null}
        onClick={() => run("delete", deleteDocument)}
        className={`${CONTROL_SECONDARY} px-2 py-1 text-xs text-negative`}
      >
        {pending === "delete" ? "Deleting…" : "Delete"}
      </button>
    </div>
  );
}
