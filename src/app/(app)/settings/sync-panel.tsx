"use client";

import Link from "next/link";
import { useState } from "react";
import { runSync, type UpdateActionResult } from "@/app/(app)/updates/actions";

export function SyncPanel({
  syncQuery,
  pendingCount,
}: {
  syncQuery: string;
  pendingCount: number;
}) {
  const [result, setResult] = useState<UpdateActionResult>(undefined);
  const [pending, setPending] = useState(false);

  return (
    <div className="space-y-3">
      {/* One button: syncing saves whatever query is on screen, so what you see
          is always what runs. The hint sits below the whole row so it cannot
          drag the button out of line with the field. */}
      <form
        className="space-y-1"
        action={async (form) => {
          setPending(true);
          setResult(await runSync(form));
          setPending(false);
        }}
      >
        <label htmlFor="syncQuery" className="block text-sm text-muted">
          Gmail search query
        </label>
        <div className="flex items-center gap-2">
          <input
            id="syncQuery"
            name="syncQuery"
            defaultValue={syncQuery}
            className="min-w-0 flex-1 rounded-md border border-border bg-surface px-3 py-1.5 font-mono text-sm"
          />
          <button
            type="submit"
            disabled={pending}
            className="shrink-0 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60"
          >
            {pending ? "Syncing…" : "Sync Now"}
          </button>
        </div>
        <p className="text-xs text-muted">
          Only messages matching this are ever read, by both sync and import. Syncing saves it.
          Example: <code>label:investments OR from:jane@acme.com</code>
        </p>
      </form>

      {pendingCount > 0 && (
        <Link href="/updates" className="inline-block text-sm underline">
          {pendingCount} update{pendingCount === 1 ? "" : "s"} awaiting review
        </Link>
      )}

      {result?.status === "error" && <p className="text-sm text-negative">{result.message}</p>}
      {result?.status === "ok" && <p className="text-sm text-muted">{result.message}</p>}
    </div>
  );
}
