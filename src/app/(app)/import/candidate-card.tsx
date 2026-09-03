"use client";

import { useState } from "react";
import { dismissCandidate, importCandidate } from "./actions";

/// The editable footer of a proposal. Name, website and sector are the three
/// fields worth correcting before import; everything else is easier to fix on
/// the company page afterwards.
export function CandidateCard({
  id,
  name,
  website,
  sector,
}: {
  id: string;
  name: string;
  website: string;
  sector: string;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  return (
    <div className="mt-3 border-t border-border pt-3">
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
        <label className="text-sm">
          <span className="text-xs text-muted">Name</span>
          <input
            name="name"
            defaultValue={name}
            className="mt-1 block rounded-md border border-border bg-surface px-2 py-1 text-sm"
          />
        </label>
        <label className="text-sm">
          <span className="text-xs text-muted">Website</span>
          <input
            name="website"
            defaultValue={website}
            className="mt-1 block rounded-md border border-border bg-surface px-2 py-1 text-sm"
          />
        </label>
        <label className="text-sm">
          <span className="text-xs text-muted">Sector</span>
          <input
            name="sector"
            defaultValue={sector}
            className="mt-1 block rounded-md border border-border bg-surface px-2 py-1 text-sm"
          />
        </label>
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60"
        >
          {pending ? "Importing…" : "Import"}
        </button>
        <button
          type="submit"
          formAction={dismissCandidate}
          className="rounded-md border border-border px-3 py-1.5 text-sm"
        >
          Not an Investment
        </button>
      </form>
      {error && <p className="mt-2 text-sm text-negative">{error}</p>}
    </div>
  );
}
