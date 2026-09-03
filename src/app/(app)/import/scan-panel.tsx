"use client";

import { useState } from "react";
import { importAll, runScan, type ImportResult } from "./actions";

export function ScanPanel({
  defaultQuery,
  hasCandidates,
  importedCount,
}: {
  defaultQuery: string;
  hasCandidates: boolean;
  importedCount: number;
}) {
  const [result, setResult] = useState<ImportResult>(undefined);
  const [pending, setPending] = useState(false);

  async function run(work: () => Promise<ImportResult>) {
    setPending(true);
    setResult(await work());
    setPending(false);
  }

  return (
    <div className="space-y-3">
      <form
        className="flex flex-wrap items-end gap-2"
        action={(form) => run(() => runScan(form))}
      >
        <label className="min-w-64 flex-1 text-sm">
          <span className="text-muted">Gmail search query</span>
          <input
            name="query"
            defaultValue={defaultQuery}
            className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-1.5 font-mono text-sm"
          />
          <span className="mt-0.5 block text-xs text-muted">
            Widen it for a first import if your older deals were never labelled, for example{" "}
            <code>label:investments OR subject:(SAFE OR &quot;investor update&quot;)</code>
          </span>
        </label>
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60"
        >
          {pending ? "Scanning…" : "Scan mailbox"}
        </button>
      </form>

      {hasCandidates && (
        <button
          type="button"
          disabled={pending}
          onClick={() => run(importAll)}
          className="rounded-md border border-border px-3 py-1.5 text-sm disabled:opacity-60"
        >
          Import all proposals
        </button>
      )}

      {importedCount > 0 && (
        <p className="text-xs text-muted">
          {importedCount} compan{importedCount === 1 ? "y" : "ies"} already imported. Rescans skip
          them.
        </p>
      )}

      {result?.status === "error" && <p className="text-sm text-negative">{result.message}</p>}
      {result?.status === "ok" && <p className="text-sm text-muted">{result.message}</p>}
    </div>
  );
}
