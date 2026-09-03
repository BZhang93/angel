import Link from "next/link";
import { EmptyState, Pill, SeverityBadge } from "@/components/ui";
import { getCompanySummaries } from "@/lib/data/portfolio";
import { money, multiple, percent, shortDate, titleCase } from "@/lib/format";
import { requireUserId } from "@/lib/session";

export default async function CompaniesPage() {
  const userId = await requireUserId();
  const summaries = await getCompanySummaries(userId);

  if (summaries.length === 0) {
    return (
      <EmptyState
        title="No companies yet"
        body="Add a company, then record the instrument and the money that went in."
        cta={{ href: "/companies/new", label: "Add a company" }}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Companies</h1>
        <Link
          href="/companies/new"
          className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white"
        >
          Add company
        </Link>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border bg-surface">
        <table className="w-full min-w-[54rem] text-sm">
          <thead className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
            <tr>
              <th className="px-4 py-2 font-medium">Company</th>
              <th className="px-4 py-2 font-medium">Instruments</th>
              <th className="px-4 py-2 text-right font-medium">Deployed</th>
              <th className="px-4 py-2 text-right font-medium">Value</th>
              <th className="px-4 py-2 text-right font-medium">MOIC</th>
              <th className="px-4 py-2 text-right font-medium">IRR</th>
              <th className="px-4 py-2 font-medium">Last update</th>
              <th className="px-4 py-2 font-medium">Flags</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {summaries.map((company) => (
              <tr key={company.id} className="hover:bg-background/60">
                <td className="px-4 py-2">
                  <Link href={`/companies/${company.id}`} className="font-medium hover:underline">
                    {company.name}
                  </Link>
                  <div className="text-xs text-muted">
                    {company.sector ?? "Unspecified"} · {titleCase(company.status)}
                  </div>
                </td>
                <td className="px-4 py-2">
                  <div className="flex flex-wrap gap-1">
                    {company.instruments.map((instrument) => (
                      <Pill key={instrument}>{titleCase(instrument)}</Pill>
                    ))}
                  </div>
                </td>
                <td className="tabular px-4 py-2 text-right">{money(company.deployed)}</td>
                <td className="tabular px-4 py-2 text-right">
                  {money(company.realized + company.unrealized)}
                </td>
                <td className="tabular px-4 py-2 text-right">{multiple(company.moic)}</td>
                <td className="tabular px-4 py-2 text-right">{percent(company.irr)}</td>
                <td className="px-4 py-2 text-muted">{shortDate(company.lastUpdateAt)}</td>
                <td className="px-4 py-2">
                  <div className="flex flex-wrap gap-1">
                    {company.signals.slice(0, 2).map((signal, index) => (
                      <SeverityBadge key={`${signal.kind}-${index}`} severity={signal.severity} />
                    ))}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
