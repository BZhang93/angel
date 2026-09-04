"use client";

import { useState } from "react";
import { scanForUpdates, type UpdateActionResult } from "./actions";

/// Searches the mailbox for mail from companies already in the portfolio.
/// Scoped to one company when companyId is given, otherwise the whole book.
export function ScanUpdatesButton({
  companyId,
  label = "Scan For Updates",
  variant = "secondary",
}: {
  companyId?: string;
  label?: string;
  variant?: "primary" | "secondary";
}) {
  const [result, setResult] = useState<UpdateActionResult>(undefined);
  const [pending, setPending] = useState(false);

  const className =
    variant === "primary"
      ? "rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60"
      : "rounded-md border border-border px-3 py-1.5 text-sm disabled:opacity-60";

  return (
    <div className="flex flex-col items-end gap-1">
      <form
        action={async (form) => {
          setPending(true);
          setResult(await scanForUpdates(form));
          setPending(false);
        }}
      >
        {companyId && <input type="hidden" name="companyId" value={companyId} />}
        <button type="submit" disabled={pending} className={className}>
          {pending ? "Scanning…" : label}
        </button>
      </form>
      {result?.status === "error" && <p className="text-sm text-negative">{result.message}</p>}
      {result?.status === "ok" && <p className="text-right text-xs text-muted">{result.message}</p>}
    </div>
  );
}
