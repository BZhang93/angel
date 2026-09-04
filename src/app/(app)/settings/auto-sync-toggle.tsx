"use client";

import { useState } from "react";
import { CONTROL_SECONDARY } from "@/components/ui";
import { setAutoSync, type UpdateActionResult } from "@/app/(app)/updates/actions";

/// Auto-sync, served two ways: a Gmail push subscription where one is
/// configured, and the hourly scheduled run otherwise. Google cannot push to a
/// laptop, so local development always uses the second.
export function AutoSyncToggle({ enabled, pushReady }: { enabled: boolean; pushReady: boolean }) {
  const [result, setResult] = useState<UpdateActionResult>(undefined);
  const [pending, setPending] = useState(false);

  return (
    <div className="space-y-1">
      <form
        className="flex flex-wrap items-center gap-2"
        action={async (form) => {
          setPending(true);
          setResult(await setAutoSync(form));
          setPending(false);
        }}
      >
        <input type="hidden" name="enabled" value={String(!enabled)} />
        <button type="submit" disabled={pending} className={CONTROL_SECONDARY}>
          {pending ? "Saving…" : enabled ? "Turn Auto-Sync Off" : "Turn Auto-Sync On"}
        </button>
        <span className="text-sm text-muted">
          {enabled
            ? pushReady
              ? "On. New mail is ingested as it arrives, with an hourly run as backstop."
              : "On. Ingesting hourly on a schedule."
            : "Off. Nothing is read until you press Sync Now."}
        </span>
      </form>
      {result?.status === "ok" && <p className="text-xs text-muted">{result.message}</p>}
      {result?.status === "error" && <p className="text-xs text-negative">{result.message}</p>}
      {!pushReady && (
        <p className="text-xs text-muted">
          Instant delivery needs a Google Cloud Pub/Sub topic in GOOGLE_PUBSUB_TOPIC and a
          deployment Google can reach. Without it this polls hourly, which is the only option on a
          laptop.
        </p>
      )}
    </div>
  );
}
