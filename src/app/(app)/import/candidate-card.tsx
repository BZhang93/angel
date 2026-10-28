"use client";

import { useState } from "react";
import { dismissCandidate, importCandidate } from "./actions";
import { CONTROL_PRIMARY, CONTROL_SECONDARY } from "@/components/ui";

/// The editable footer of a proposal. Name, website and sector are the three
/// fields worth correcting before import; everything else is easier to fix on
/// the company page afterwards.
export function CandidateCard({
  id,
  name,
  website,
  sector,
  mergeHint,
}: {
  id: string;
  name: string;
  website: string;
  sector: string;
  /// Set when importing will join an existing company rather than create one.
  mergeHint: { mergesInto: string; reason: string } | null;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  return (
    <div className="mt-3 border-t border-border pt-3">
      {mergeHint && (
        <p className="mb-2 text-xs text-muted">
          Will be added to the existing <strong>{mergeHint.mergesInto}</strong> ({mergeHint.reason})
          rather than creating a second entry. Edit the name below to keep them separate.
        </p>
      )}
      {/* items-end, not items-center: each field is a label stacked on an
          input, so it is taller than a bare button, and centring hung the
          buttons above the inputs they belong to. Aligning the bottoms puts
          every control on one line, and the inputs borrow the shared control
          geometry so they are the same height as the buttons rather than
          nearly. See the note on ControlRow. */}
      <form
        className="flex flex-wrap items-end gap-2"
        action={async (form) => {
          setPending(true);
          const result = await importCandidate(form);
          setError(result?.status === "error" ? result.message : null);
          setPending(false);
        }}
      >
        <input type="hidden" name="id" value={id} />
        <label className="min-w-32 flex-1 text-sm">
          <span className="text-xs text-muted">Name</span>
          <input
            name="name"
            defaultValue={name}
            className={`mt-1 block w-full ${CONTROL_SECONDARY}`}
          />
        </label>
        <label className="min-w-32 flex-1 text-sm">
          <span className="text-xs text-muted">Website</span>
          <input
            name="website"
            defaultValue={website}
            className={`mt-1 block w-full ${CONTROL_SECONDARY}`}
          />
        </label>
        <label className="min-w-32 flex-1 text-sm">
          <span className="text-xs text-muted">Sector</span>
          <input
            name="sector"
            defaultValue={sector}
            className={`mt-1 block w-full ${CONTROL_SECONDARY}`}
          />
        </label>
        <button
          type="submit"
          disabled={pending}
          className={`shrink-0 ${CONTROL_PRIMARY}`}
        >
          {pending ? "Importing…" : mergeHint ? "Merge In" : "Import"}
        </button>
        <button
          type="submit"
          formAction={dismissCandidate}
          className={`shrink-0 ${CONTROL_SECONDARY}`}
        >
          Not an Investment
        </button>
      </form>
      {error && <p className="mt-2 text-sm text-negative">{error}</p>}
    </div>
  );
}
