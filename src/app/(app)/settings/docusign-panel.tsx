"use client";

import { useState } from "react";
import { runDocusignSync, type UpdateActionResult } from "@/app/(app)/updates/actions";

export function DocusignPanel({ accountName }: { accountName: string | null }) {
  const [result, setResult] = useState<UpdateActionResult>(undefined);
  const [pending, setPending] = useState(false);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={async () => {
            setPending(true);
            setResult(await runDocusignSync());
            setPending(false);
          }}
          className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60"
        >
          {pending ? "Pulling Envelopes…" : "Pull Signed Documents"}
        </button>
        {accountName && <span className="text-xs text-muted">{accountName}</span>}
      </div>
      {result?.status === "error" && <p className="text-sm text-negative">{result.message}</p>}
      {result?.status === "ok" && <p className="text-sm text-muted">{result.message}</p>}
    </div>
  );
}
