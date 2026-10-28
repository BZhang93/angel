import Link from "next/link";
import {
  CONTROL_PRIMARY,
  Card,
  EmptyState,
  SeverityBadge,
  Stat,
  TrendIndicator,
} from "@/components/ui";
import {
  concentration,
  getCompanySummaries,
  rollUp,
} from "@/lib/data/portfolio";
import { getKeyDates } from "@/lib/data/calendar";
import { shapeKeyDates } from "@/lib/key-dates";
import { KeyDatesCard } from "./key-dates-card";
import { getVehicles } from "@/lib/data/vehicles";
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
  // Shaped rather than sliced. A plain slice of the soonest six was how the
  // card came to show nothing but the past: every date it had was overdue, and
  // six of the eight belonged to one closed deal.
  const HORIZON_DAYS = 180;
  const shaped = shapeKeyDates(
    await getKeyDates(userId, { asOf, horizonDays: HORIZON_DAYS }),
    { limit: 5 },
  );
  const toCardDate = (entry: (typeof shaped)["upcoming"][number]) => ({
    kind: entry.kind,
    dateLabel: shortDate(entry.date),
    relative: relativeDays(entry.daysAway),
    companyId: entry.companyId,
    companyName: entry.companyName,
    label: entry.label,
    actionItemId: entry.actionItemId,
  });
  const vehicles = await getVehicles(userId);
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

  // Only what is actually moving. Six neutral rows of dashes would crowd out
  // the two companies with something to say, so the rest are a footnote.
  const moving = summaries
    .filter((company) => company.trend.trend !== "NEUTRAL")
    .sort((a, b) => a.trend.score - b.trend.score);
  const steady = summaries.length - moving.length;

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
        <Stat
          label="Deployed"
          value={money(totals.deployed)}
          sub={
            totals.fees > 0
              ? `${totals.companyCount} companies · includes ${money(totals.fees)} fees`
              : `${totals.companyCount} companies`
          }
        />
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
          sub={[
            `${totals.exitedCount} exited`,
            // Only when it has happened: a standing "0 closed" is noise, and a
            // closed company counted as active would overstate the bets
            // actually running.
            totals.closedCount > 0 ? `${totals.closedCount} closed` : null,
            unrecorded > 0 ? `${unrecorded} without an amount` : `${totals.deadCount} written off`,
          ]
            .filter(Boolean)
            .join(" · ")}
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
        <Card title="Trending">
          {moving.length === 0 ? (
            <p className="py-4 text-sm text-muted">
              Nothing is moving either way. A company needs reported numbers or recent news before
              a direction means anything.
            </p>
          ) : (
            <>
              <ul className="divide-y divide-border">
                {moving.map(({ id, name, trend }) => (
                  <li key={id} className="flex items-baseline justify-between gap-3 py-2">
                    <div className="min-w-0">
                      <Link href={`/companies/${id}`} className="text-sm font-medium hover:underline">
                        {name}
                      </Link>
                      <p className="truncate text-sm text-muted">
                        {trend.evidence
                          .slice(0, 2)
                          .map((entry) => entry.label)
                          .join(" · ")}
                      </p>
                    </div>
                    <TrendIndicator trend={trend.trend} />
                  </li>
                ))}
              </ul>
              {steady > 0 && (
                <p className="pt-2 text-sm text-muted">
                  {steady} other{steady === 1 ? "" : "s"} neutral, for want of recent numbers or news.
                </p>
              )}
            </>
          )}
        </Card>

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

        <KeyDatesCard
          upcoming={shaped.upcoming.map(toCardDate)}
          overdue={shaped.overdue.map(toCardDate)}
          staleCount={shaped.stale.length}
          hidden={shaped.hidden}
          horizonDays={HORIZON_DAYS}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
      {vehicles.length > 0 && (
        <Card title="Vehicles">
          <ul className="divide-y divide-border">
            {vehicles.map((vehicle) => (
              <li key={vehicle.name} className="flex flex-wrap items-baseline justify-between gap-3 py-2">
                <Link href="/vehicles" className="text-sm font-medium hover:underline">
                  {vehicle.name}
                </Link>
                <div className="tabular flex flex-wrap items-baseline gap-4 text-sm text-muted">
                  <span>{vehicle.holdings.length} investments</span>
                  <span>{money(vehicle.deployed)} routed</span>
                  <span>
                    {money(vehicle.fees)} fees
                    {vehicle.feeRate != null ? ` · ${percent(vehicle.feeRate)}` : ""}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

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
