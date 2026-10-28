"use client";

import { useState } from "react";
import { ActionForm, Field } from "@/components/forms";
import { OUTCOMES } from "@/lib/position-status";
import { closePosition } from "../actions";

/// Closing a position, with the consequences of the choice visible while it is
/// being made.
///
/// Client-side because the blurb and the amount field follow the outcome: a
/// write-off asks for a date and no money, a cancelled commitment asks for
/// neither, and an exit asks for the proceeds. Offering one static form for all
/// six invites a write-off recorded with a $2,000 payment attached.
export function ClosePosition({
  positionId,
  deployed,
}: {
  positionId: string;
  deployed: number;
}) {
  const [status, setStatus] = useState(OUTCOMES[0]!.status);
  const outcome = OUTCOMES.find((entry) => entry.status === status)!;

  return (
    <details className="mt-3">
      <summary className="cursor-pointer text-xs text-muted">Close Position</summary>
      <div className="mt-2">
        <ActionForm action={closePosition} submitLabel="Close Position" compact>
          <input type="hidden" name="positionId" value={positionId} />
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="block text-sm">
              <span className="text-muted">Outcome</span>
              <select
                name="status"
                value={status}
                onChange={(event) => setStatus(event.target.value as typeof status)}
                className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-1.5"
              >
                {OUTCOMES.map((entry) => (
                  <option key={entry.status} value={entry.status}>
                    {entry.label}
                  </option>
                ))}
              </select>
            </label>
            <Field label="Date" name="date" type="date" required />
            {outcome.expectsProceeds && (
              <Field
                label="Amount received"
                name="amount"
                type="number"
                // Defaulted to everything that went out, which is right for a
                // refund and a starting point for the rest.
                defaultValue={String(deployed)}
                required
              />
            )}
          </div>
          <p className="text-xs text-muted">{outcome.blurb}</p>
        </ActionForm>
      </div>
    </details>
  );
}
