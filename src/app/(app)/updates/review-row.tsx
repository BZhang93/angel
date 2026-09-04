"use client";

import { useState } from "react";
import { confirmUpdate, rejectUpdate } from "./actions";
import { CONTROL_PRIMARY, CONTROL_SECONDARY } from "@/components/ui";

export function ReviewRow({
  updateId,
  companies,
  suggestedCompanyId,
}: {
  updateId: string;
  companies: { id: string; name: string }[];
  suggestedCompanyId: string | null;
}) {
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  return (
    <div className="mt-3 space-y-2">
      <form
        className="flex flex-wrap items-center gap-2"
        action={async (form) => {
          setPending(true);
          const result = await confirmUpdate(form);
          setMessage(result?.status === "error" ? result.message : null);
          setPending(false);
        }}
      >
        <input type="hidden" name="updateId" value={updateId} />
        <select
          name="companyId"
          defaultValue={suggestedCompanyId ?? ""}
          className={CONTROL_SECONDARY}
        >
          <option value="">Choose a company…</option>
          {companies.map((company) => (
            <option key={company.id} value={company.id}>
              {company.name}
            </option>
          ))}
        </select>
        <button
          type="submit"
          disabled={pending}
          className={CONTROL_PRIMARY}
        >
          {pending ? "Extracting…" : "Assign and Extract"}
        </button>
        <button
          type="submit"
          formAction={rejectUpdate}
          className={CONTROL_SECONDARY}
        >
          Not an Update
        </button>
      </form>
      {message && <p className="text-sm text-negative">{message}</p>}
    </div>
  );
}
