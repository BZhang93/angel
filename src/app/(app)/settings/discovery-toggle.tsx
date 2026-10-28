"use client";

import { useState } from "react";
import { CONTROL_SECONDARY } from "@/components/ui";
import { setAutoDiscover, type UpdateActionResult } from "@/app/(app)/updates/actions";

/// Discovery reads beyond the user's own label, so it gets its own visible
/// switch rather than riding along with auto-sync. The copy says what is read
/// and what is stored, because those are different and the difference is the
/// point: refused mail is never kept and never reaches the model.
export function DiscoveryToggle({ enabled, days }: { enabled: boolean; days: number }) {
  const [result, setResult] = useState<UpdateActionResult>(undefined);
  const [pending, setPending] = useState(false);

  return (
    <div className="space-y-1">
      <form
        className="flex flex-wrap items-center gap-2"
        action={async (form) => {
          setPending(true);
          setResult(await setAutoDiscover(form));
          setPending(false);
        }}
      >
        <input type="hidden" name="enabled" value={String(!enabled)} />
        <button type="submit" disabled={pending} className={CONTROL_SECONDARY}>
          {pending ? "Saving…" : enabled ? "Stop Finding Unlabelled Mail" : "Find Unlabelled Mail"}
        </button>
        <span className="text-sm text-muted">
          {enabled
            ? `On. Also searching the last ${days} days for investment mail you never labelled.`
            : "Off. Only mail matching the query above, and mail from companies already in the portfolio."}
        </span>
      </form>
      {result?.status === "ok" && <p className="text-xs text-muted">{result.message}</p>}
      {result?.status === "error" && <p className="text-xs text-negative">{result.message}</p>}
      <p className="text-xs text-muted">
        Searching happens inside Gmail. An email is only stored when it carries the vocabulary of an
        investment: an update subject, wire instructions, a valuation cap, a signed SAFE. Everything
        else is left where it is, unread and unstored, and each email that is kept says in your
        review queue why it was.
      </p>
    </div>
  );
}
