"use client";

import { useState } from "react";
import { CONTROL_PRIMARY, CONTROL_SECONDARY } from "@/components/ui";
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

  const className = variant === "primary" ? CONTROL_PRIMARY : CONTROL_SECONDARY;

  // `contents` lets the button participate directly in the parent ControlRow,
  // so this component never introduces a taller child that breaks alignment.
  // The result message takes a full basis, dropping onto its own line.
  return (
    <div className="contents">
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
