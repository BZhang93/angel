"use client";

import { useState } from "react";
import { CONTROL_SECONDARY } from "@/components/ui";
import { rematchQueue, type UpdateActionResult } from "./actions";

/// Reconsiders the queue against the portfolio as it stands now. The fix for
/// mail that synced before any companies existed: it matched nothing then, and
/// nothing went back to look again.
export function RematchButton() {
  const [result, setResult] = useState<UpdateActionResult>(undefined);
  const [pending, setPending] = useState(false);

  return (
    <div className="contents">
      <button
        type="button"
        disabled={pending}
        onClick={async () => {
          setPending(true);
          setResult(await rematchQueue());
          setPending(false);
        }}
        className={CONTROL_SECONDARY}
      >
        {pending ? "Matching…" : "Re-match Queue"}
      </button>
      {result != null && (
        <p
          className={`basis-full text-xs ${result.status === "error" ? "text-negative" : "text-muted"}`}
        >
          {result.message}
        </p>
      )}
    </div>
  );
}
