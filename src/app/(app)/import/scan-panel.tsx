"use client";

import { useState } from "react";
import { importAll, runScan, type ImportResult } from "./actions";

export function ScanPanel({
  defaultQuery,
  hasCandidates,
  importedCount,
  running,
}: {
  defaultQuery: string;
  hasCandidates: boolean;
  importedCount: number;
  /// A scan started elsewhere (or before a reload) is still going: the button
  /// stays disabled so it cannot be launched twice.
  running: boolean;
}) {
  const [result, setResult] = useState<ImportResult>(undefined);
  const [submitting, setSubmitting] = useState(false);
  const pending = submitting || running;

  async function run(work: () => Promise<ImportResult>) {
    setSubmitting(true);
    setResult(await work());
    setSubmitting(false);
  }

  return (
    <div className="space-y-3">
      <form className="space-y-1" action={(form) => run(() => runScan(form))}>
        <label htmlFor="query" className="block text-sm text-muted">
          Gmail search query
        </label>
        <div className="flex items-center gap-2">
          <input
            id="query"
            name="query"
            defaultValue={defaultQuery}
            className="min-w-0 flex-1 rounded-md border border-border bg-surface px-3 py-1.5 font-mono text-sm"
          />
          <button
            type="submit"
            disabled={pending}
            className="shrink-0 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60"
          >
            {pending ? "Scanning…" : "Scan Mailbox"}
          </button>
        </div>
        <p className="text-xs text-muted">
          Widen it for a first import if your older deals were never labelled, for example{" "}
          <code>label:investments OR subject:(SAFE OR &quot;investor update&quot;)</code>. This one
          is used for the scan only and does not change your saved sync query.
        </p>
      </form>

      {(hasCandidates || importedCount > 0) && (
        <div className="flex flex-wrap items-center gap-3 border-t border-border pt-3">
          {hasCandidates && (
            <button
              type="button"
              disabled={pending}
              onClick={() => run(importAll)}
              className="rounded-md border border-border px-3 py-1.5 text-sm disabled:opacity-60"
            >
              Import All Proposals
            </button>
          )}
          {importedCount > 0 && (
            <p className="text-xs text-muted">
              {importedCount} compan{importedCount === 1 ? "y" : "ies"} already imported. Rescans
              skip them.
            </p>
          )}
        </div>
      )}

      {result?.status === "error" && <p className="text-sm text-negative">{result.message}</p>}
      {result?.status === "ok" && <p className="text-sm text-muted">{result.message}</p>}
    </div>
  );
}
