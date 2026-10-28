import Link from "next/link";
import { CONTROL_PRIMARY, EmptyState, Pill, SeverityBadge, TrendIndicator } from "@/components/ui";
import { getCompanySummaries } from "@/lib/data/portfolio";
import { money, multiple, percent, shortDate, titleCase } from "@/lib/format";
import { requireUserId } from "@/lib/session";
import { ScanUpdatesButton } from "../updates/scan-updates-button";

export default async function CompaniesPage() {
  const userId = await requireUserId();
  const summaries = await getCompanySummaries(userId);

  if (summaries.length === 0) {
    return (
      <EmptyState
        title="No Companies Yet"
        body="Add a company, then record the instrument and the money that went in."
        cta={{ href: "/companies/new", label: "Add a Company" }}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h1 className="text-lg font-semibold">Companies</h1>
        <div className="flex items-start gap-2">
          <ScanUpdatesButton />
          <Link
            href="/companies/new"
            className={CONTROL_PRIMARY}
          >
            Add Company
          </Link>
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border bg-surface">
        <table className="w-full min-w-[54rem] text-sm">
          <thead className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
            <tr>
              <th className="px-4 py-2 font-medium">Company</th>
              <th className="px-4 py-2 font-medium">Instruments</th>
              <th className="px-4 py-2 font-medium">Vehicle</th>
              <th
                className="cursor-help px-4 py-2 text-right font-medium"
                title="Total cash out, fees included. A fee bought no ownership, so hiding it would flatter the return."
              >
                Deployed
              </th>
              <th className="px-4 py-2 text-right font-medium">Value</th>
              <th className="px-4 py-2 text-right font-medium">MOIC</th>
              <th className="px-4 py-2 text-right font-medium">IRR</th>
              <th className="px-4 py-2 font-medium">Last Update</th>
              <th
                className="cursor-help px-4 py-2 font-medium"
                title="Reported growth over recent periods, plus what the last 90 days of signals said. Neutral means there is not enough to call."
              >
                Trend
              </th>
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
                    {company.outcome && ` · ${company.outcome}`}
                  </div>
                </td>
                <td className="px-4 py-2">
                  <div className="flex flex-wrap gap-1">
                    {company.instruments.map((instrument) => (
                      <Pill key={instrument}>{titleCase(instrument)}</Pill>
                    ))}
                  </div>
                </td>
                <td className="px-4 py-2">
                  {company.investmentGroups.length > 0 ? (
                    <div className="flex flex-wrap gap-1">
                      {company.investmentGroups.map((group) => (
                        <Link
                          key={group}
                          href="/vehicles"
                          className="text-sm hover:underline"
                          title="Held through this vehicle. See what it costs on the Vehicles page."
                        >
                          {group}
                        </Link>
                      ))}
                    </div>
                  ) : (
                    <span className="text-sm text-muted">Direct</span>
                  )}
                </td>
                {company.positionCount === 0 ? (
                  <td colSpan={4} className="px-4 py-2 text-right text-sm text-muted">
                    No position recorded —{" "}
                    <Link href={`/companies/${company.id}`} className="underline">
                      add the amount
                    </Link>
                  </td>
                ) : (
                  <>
                        <td
                      className="tabular px-4 py-2 text-right"
                      title={
                        company.fees > 0
                          ? `${money(company.invested)} invested plus ${money(company.fees)} of fees`
                          : undefined
                      }
                    >
                      {money(company.deployed)}
                      {company.fees > 0 && (
                        <span className="block text-xs font-normal text-muted">
                          incl. {money(company.fees)} fees
                        </span>
                      )}
                    </td>
                    <td className="tabular px-4 py-2 text-right">
                      {money(company.realized + company.unrealized)}
                    </td>
                    <td className="tabular px-4 py-2 text-right">{multiple(company.moic)}</td>
                    <td className="tabular px-4 py-2 text-right">{percent(company.irr)}</td>
                  </>
                )}
                <td className="px-4 py-2 text-muted">{shortDate(company.lastUpdateAt)}</td>
                <td className="px-4 py-2">
                  <TrendIndicator
                    trend={company.trend.trend}
                    title={
                      company.trend.evidence
                        .slice(0, 3)
                        .map((entry) => entry.label)
                        .join(" · ") || "Nothing reported recently."
                    }
                  />
                </td>
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
