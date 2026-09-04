"use client";

import { useRef, useState } from "react";
import { uploadDocument } from "../actions";

/// Drop in a signed SAFE, note or side letter and have it read on the spot.
/// The way in when DocuSign's API is off the table, which it is on plans that
/// exclude API access.
export function UploadDocument({ companyId }: { companyId: string }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <form
      ref={formRef}
      className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3"
      action={async (form) => {
        setPending(true);
        const result = await uploadDocument(form);
        setError(result?.status === "error" ? result.message : null);
        setPending(false);
        if (!result) formRef.current?.reset();
      }}
    >
      <input type="hidden" name="companyId" value={companyId} />
      <input
        type="file"
        name="file"
        accept="application/pdf,.pdf"
        required
        className="max-w-full text-sm text-muted file:mr-3 file:rounded-md file:border file:border-border file:bg-surface file:px-3 file:py-1.5 file:text-sm file:text-foreground"
      />
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60"
      >
        {pending ? "Reading…" : "Upload And Read"}
      </button>
      {error && <p className="w-full text-sm text-negative">{error}</p>}
      <p className="w-full text-xs text-muted">
        A signed PDF is read for its cap, discount, maturity and share terms, which fill anything
        the position is missing. Nothing you entered by hand is overwritten.
      </p>
    </form>
  );
}
