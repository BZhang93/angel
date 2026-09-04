import Link from "next/link";
import { CONTROL_PRIMARY, Card, EmptyState, SeverityBadge, Stat } from "@/components/ui";
import {
  concentration,
  getCompanySummaries,
  rollUp,
} from "@/lib/data/portfolio";
import { getKeyDates } from "@/lib/data/calendar";
import { money, multiple, percent, relativeDays, shortDate } from "@/lib/format";
import { requireUserId } from "@/lib/session";
import { prisma } from "@/lib/prisma";

export default async function DashboardPage() {
  const userId = await requireUserId();
  const asOf = new Date();
  const summaries = await getCompanySummaries(userId, asOf);
  const totals = rollUp(summaries);
  // Companies proved by investor updates but with no cheque on file. Worth
  // surfacing: they are silently missing from every total.
  const unrecorded = summaries.filter((company) => company.positionCount === 0).length;
  const keyDates = (await getKeyDates(userId, { asOf, horizonDays: 180 })).slice(0, 6);
  const unreconciled = await prisma.payment.findMany({
    where: { userId, state: { in: ["DISCREPANCY", "UNMATCHED"] } },
    include: { company: { select: { id: true, name: true } } },
    orderBy: { valueDate: "desc" },
    take: 5,
  });

  if (summaries.length === 0) {
    return (
      <EmptyState
        title="No Investments Yet"
        body="Add the first company to start tracking terms, transactions, key dates and risk."
        cta={{ href: "/companies/new", label: "Add a Company" }}
      />
    );
  }

  const risks = summaries
    .flatMap((company) => company.signals.map((signal) => ({ company, signal })))
    .sort((a, b) => {
      const order = ["CRITICAL", "HIGH", "MEDIUM", "LOW"];
      return order.indexOf(a.signal.severity) - order.indexOf(b.signal.severity);
    })
    .slice(0, 8);

  const bySector = concentration(summaries, (company) => company.sector ?? "Unspecified").slice(0, 6);
  const byVintage = concentration(summaries, (company) =>
    company.firstInvestmentAt ? String(company.firstInvestmentAt.getUTCFullYear()) : "Undated",
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Portfolio</h1>
        <Link
          href="/companies/new"
          className={CONTROL_PRIMARY}
        >
          Add Company
        </Link>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Deployed" value={money(totals.deployed)} sub={`${totals.companyCount} companies`} />
        <Stat label="Current value" value={money(totals.totalValue)} sub={`${money(totals.realized)} realized`} />
        <Stat
          label="MOIC"
          value={multiple(totals.moic)}
          tone={totals.moic != null && totals.moic >= 1 ? "positive" : "negative"}
          sub={`${money(totals.unrealized)} unrealized`}
        />
        <Stat
          label="Status"
          value={`${totals.activeCount} active`}
          sub={
            unrecorded > 0
              ? `${totals.exitedCount} exited · ${unrecorded} without an amount`
              : `${totals.exitedCount} exited · ${totals.deadCount} written off`
          }
        />
      </div>

      {unreconciled.length > 0 && (
        <Card title="Transfers To Reconcile">
          <ul className="divide-y divide-border">
            {unreconciled.map((payment) => (
              <li key={payment.id} className="flex items-start justify-between gap-3 py-2">
                <div className="min-w-0">
                  <span className="text-sm font-medium">
                    {payment.company ? (
                      <Link href={`/companies/${payment.company.id}`} className="hover:underline">
                        {payment.company.name}
                      </Link>
                    ) : (
                      (payment.beneficiary ?? "Unmatched transfer")
                    )}
                  </span>
                  <p className="text-sm text-muted">{payment.note}</p>
                </div>
                <span className="tabular shrink-0 text-sm">
                  {money(Number(payment.amount.toString()))}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Needs Attention">
          {risks.length === 0 ? (
            <p className="py-4 text-sm text-muted">
              No open risk flags. Every company has reported inside 90 days.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {risks.map(({ company, signal }, index) => (
                <li key={`${company.id}-${signal.kind}-${index}`} className="flex gap-3 py-2">
                  <SeverityBadge severity={signal.severity} />
                  <div className="min-w-0">
                    <Link href={`/companies/${company.id}`} className="text-sm font-medium hover:underline">
                      {company.name}
                    </Link>
                    <p className="text-sm text-muted">{signal.summary}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Next 180 Days">
          {keyDates.length === 0 ? (
            <p className="py-4 text-sm text-muted">Nothing due in the next six months.</p>
          ) : (
            <ul className="divide-y divide-border">
              {keyDates.map((entry, index) => (
                <li key={`${entry.companyId}-${entry.kind}-${index}`} className="flex items-baseline justify-between gap-3 py-2">
                  <div className="min-w-0">
                    <Link href={`/companies/${entry.companyId}`} className="text-sm font-medium hover:underline">
                      {entry.companyName}
                    </Link>
                    <p className="truncate text-sm text-muted">{entry.label}</p>
                  </div>
                  <div className="tabular shrink-0 text-right text-xs text-muted">
                    <div>{shortDate(entry.date)}</div>
                    <div>{relativeDays(entry.daysAway)}</div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
      <Card title="Concentration by Sector">
        <ul className="space-y-2">
          {bySector.map((bucket) => (
            <li key={bucket.label} className="flex items-center gap-3">
              <span className="w-32 shrink-0 truncate text-sm">{bucket.label}</span>
              <span className="h-2 flex-1 overflow-hidden rounded-full bg-border">
                <span
                  className="block h-full rounded-full bg-accent"
                  style={{ width: `${Math.max(bucket.share * 100, 1)}%` }}
                />
              </span>
              <span className="tabular w-28 shrink-0 text-right text-sm text-muted">
                {money(bucket.deployed, { compact: true })} · {percent(bucket.share)}
              </span>
            </li>
          ))}
        </ul>
      </Card>

      <Card title="Deployed by Vintage">
        <ul className="space-y-2">
          {byVintage.map((bucket) => (
            <li key={bucket.label} className="flex items-center gap-3">
              <span className="w-32 shrink-0 truncate text-sm">{bucket.label}</span>
              <span className="h-2 flex-1 overflow-hidden rounded-full bg-border">
                <span
                  className="block h-full rounded-full bg-accent"
                  style={{ width: `${Math.max(bucket.share * 100, 1)}%` }}
                />
              </span>
              <span className="tabular w-28 shrink-0 text-right text-sm text-muted">
                {money(bucket.deployed, { compact: true })} · {percent(bucket.share)}
              </span>
            </li>
          ))}
        </ul>
      </Card>
      </div>
    </div>
  );
}
