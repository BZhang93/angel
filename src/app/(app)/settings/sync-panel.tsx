"use client";

import Link from "next/link";
import { useState } from "react";
import { runSync, saveSyncQuery, type UpdateActionResult } from "@/app/(app)/updates/actions";

export function SyncPanel({
  syncQuery,
  pendingCount,
}: {
  syncQuery: string;
  pendingCount: number;
}) {
  const [result, setResult] = useState<UpdateActionResult>(undefined);
  const [pending, setPending] = useState(false);

  async function run(work: () => Promise<UpdateActionResult>) {
    setPending(true);
    setResult(await work());
    setPending(false);
  }

  return (
    <div className="space-y-3">
      <form
        className="flex flex-wrap items-end gap-2"
        action={(form) => run(() => saveSyncQuery(form))}
      >
        <label className="min-w-64 flex-1 text-sm">
          <span className="text-muted">Gmail search query</span>
          <input
            name="syncQuery"
            defaultValue={syncQuery}
            className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-1.5 font-mono text-sm"
          />
          <span className="mt-0.5 block text-xs text-muted">
            Only messages matching this are ever read, by both sync and import. Example:{" "}
            <code>label:investments OR from:jane@acme.com</code>
          </span>
        </label>
        <button
          type="submit"
          disabled={pending}
          className="rounded-md border border-border px-3 py-1.5 text-sm disabled:opacity-60"
        >
          Save Query
        </button>
      </form>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={pending}
          onClick={() => run(runSync)}
          className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60"
        >
          {pending ? "Syncing…" : "Sync Now"}
        </button>
        {pendingCount > 0 && (
          <Link href="/updates" className="text-sm underline">
            {pendingCount} update{pendingCount === 1 ? "" : "s"} awaiting review
          </Link>
        )}
      </div>

      {result?.status === "error" && <p className="text-sm text-negative">{result.message}</p>}
      {result?.status === "ok" && <p className="text-sm text-muted">{result.message}</p>}
    </div>
  );
}
