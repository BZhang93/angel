import "server-only";
import { prisma } from "@/lib/prisma";
import {
  costBasis,
  irr,
  moic,
  totalDeployed,
  totalRealized,
  unrealizedValue,
  type CashKind,
  type Cashflow,
} from "@/lib/portfolio";
import { deriveCompanySignals, type DerivedSignal } from "@/lib/signals";
import { computeTrend, type TrendResult, type TrendSignal } from "@/lib/trend";
import { mentionsCompany } from "@/lib/gmail/content-match";
import { isClosed, sharedOutcome } from "@/lib/position-status";

// Read models for the UI. This layer does the Prisma work and hands plain
// numbers to the pure functions in portfolio.ts / signals.ts, so the maths stays
// testable and the components stay dumb.

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function toNumber(value: unknown): number {
  // Prisma Decimal has toNumber(); nulls come back as null.
  if (value == null) return 0;
  if (typeof value === "number") return value;
  return Number(value.toString());
}

function toNullableNumber(value: unknown): number | null {
  if (value == null) return null;
  return toNumber(value);
}

export interface CompanySummary {
  id: string;
  name: string;
  website: string | null;
  sector: string | null;
  status: string;
  /// Every position closed, however each one ended. Shown beside the company's
  /// own status, which says nothing about whether the investor still holds
  /// anything.
  closed: boolean;
  /// What to call the ending when there is one word for it: "Exited",
  /// "Refunded", or "Closed" when the positions ended in different ways.
  outcome: string | null;
  stage: string;
  /// Total cash out, fees included: what actually left the account.
  deployed: number;
  /// The part of it that bought ownership.
  invested: number;
  /// The part that did not.
  fees: number;
  realized: number;
  unrealized: number;
  moic: number | null;
  irr: number | null;
  instruments: string[];
  /// Zero means the amount is unknown, not that nothing was invested: an
  /// investor update proves ownership without ever stating a cheque.
  positionCount: number;
  /// Distinct syndicates or SPV managers the company is held through.
  investmentGroups: string[];
  firstInvestmentAt: Date | null;
  lastUpdateAt: Date | null;
  signals: DerivedSignal[];
  /// Which way the company is going, derived on read like MOIC.
  trend: TrendResult;
}

/// Everything the companies list and the dashboard need, in one query pass.
export async function getCompanySummaries(
  userId: string,
  asOf: Date = new Date(),
): Promise<CompanySummary[]> {
  // Unfiled mail is read once and matched in memory: 200 rows of subject and a
  // slice of body is far cheaper than a text query per company, and it is what
  // keeps the silence rule honest.
  const unfiled = await prisma.update.findMany({
    where: { userId, companyId: null },
    select: { subject: true, rawText: true, receivedAt: true },
  });

  // Metrics and signals for the trend, read in two passes rather than per
  // company. Both are dated by the email they came from: every signal row in
  // this database was written the day extraction first ran, so row age says
  // nothing about when anything happened.
  const [metricRows, signalRows] = await Promise.all([
    prisma.updateMetric.findMany({
      where: {
        update: { userId, companyId: { not: null } },
        key: { in: ["ARR", "MRR", "REVENUE", "CUSTOMERS", "GROWTH_RATE"] },
      },
      select: { key: true, value: true, update: { select: { companyId: true, receivedAt: true } } },
    }),
    prisma.signal.findMany({
      where: { userId, dismissedAt: null },
      select: {
        companyId: true,
        kind: true,
        severity: true,
        direction: true,
        derived: true,
        createdAt: true,
        update: { select: { receivedAt: true } },
      },
    }),
  ]);

  const metricsByCompany = new Map<string, { key: string; value: number; at: Date }[]>();
  for (const row of metricRows) {
    const companyId = row.update.companyId!;
    const list = metricsByCompany.get(companyId) ?? [];
    list.push({ key: row.key, value: toNumber(row.value), at: row.update.receivedAt });
    metricsByCompany.set(companyId, list);
  }

  const signalsByCompany = new Map<string, TrendSignal[]>();
  for (const row of signalRows) {
    const list = signalsByCompany.get(row.companyId) ?? [];
    list.push({
      kind: row.kind,
      severity: row.severity,
      direction: row.direction,
      derivedKind: row.derived ? row.kind : null,
      at: row.update?.receivedAt ?? row.createdAt,
    });
    signalsByCompany.set(row.companyId, list);
  }

  const companies = await prisma.company.findMany({
    where: { userId },
    include: {
      positions: { include: { transactions: true } },
      valuations: { orderBy: { date: "asc" } },
      updates: {
        where: { reviewState: "CONFIRMED" },
        orderBy: { receivedAt: "desc" },
        take: 1,
        include: { metrics: { where: { key: "RUNWAY_MONTHS" } } },
      },
    },
    orderBy: { name: "asc" },
  });

  return companies.map((company) => {
    const mentions = unfiled.filter(
      (update) =>
        mentionsCompany(update.subject ?? "", company.name) ||
        // Only the opening of the body: a name in a footer is not an update
        // about that company.
        mentionsCompany(update.rawText.slice(0, 3000), company.name),
    );
    const latestMention = mentions.reduce<Date | null>(
      (latest, update) => (!latest || update.receivedAt > latest ? update.receivedAt : latest),
      null,
    );

    const flows: Cashflow[] = company.positions.flatMap((position) =>
      position.transactions.map((transaction) => ({
        kind: transaction.kind as CashKind,
        amount: toNumber(transaction.amount),
        date: transaction.date,
      })),
    );

    const latestPriced = [...company.valuations]
      .reverse()
      .find((valuation) => valuation.pricePerShare != null);
    const shareCount = company.positions.reduce(
      (total, position) => total + toNumber(position.shareCount),
      0,
    );
    const companyIsDead = company.status === "SHUT_DOWN";
    // Every position, not any: a closed first cheque alongside a live
    // follow-on is still a live holding.
    const statuses = company.positions.map((position) => position.status);
    const closed = statuses.length > 0 && statuses.every(isClosed);
    const outcome = sharedOutcome(statuses);

    const mark = {
      shareCount: shareCount > 0 ? shareCount : null,
      latestPricePerShare: latestPriced ? toNumber(latestPriced.pricePerShare) : null,
      companyIsDead,
      closed,
    };

    const unrealized = unrealizedValue(flows, mark);
    const lastUpdate = company.updates[0] ?? null;
    const runwayMetric = lastUpdate?.metrics[0] ?? null;
    const firstInvestmentAt = company.positions.reduce<Date | null>(
      (earliest, position) =>
        !earliest || position.investmentDate < earliest ? position.investmentDate : earliest,
      null,
    );

    const derived = deriveCompanySignals(
      {
        lastUpdateAt: lastUpdate?.receivedAt ?? null,
        unfiledMentions: { count: mentions.length, latest: latestMention },
        firstInvestmentAt,
        runwayMonths: runwayMetric ? toNumber(runwayMetric.value) : null,
        maturityDates: company.positions
          .filter((position) => !position.convertedIntoId)
          .map((position) => position.maturityDate),
        qsbsPositions: company.positions.map((position) => ({
          investmentDate: position.investmentDate,
          qsbsEligible: position.qsbsEligible,
        })),
        valuations: company.valuations.map((valuation) => ({
          date: valuation.date,
          postMoneyValuation: toNullableNumber(valuation.postMoneyValuation),
        })),
      },
      asOf,
    );

    return {
      id: company.id,
      name: company.name,
      website: company.website,
      sector: company.sector,
      status: company.status,
      closed,
      outcome,
      stage: company.stage,
      deployed: totalDeployed(flows),
      invested: costBasis(flows),
      fees: round2(totalDeployed(flows) - costBasis(flows)),
      realized: totalRealized(flows),
      unrealized,
      moic: moic(flows, mark),
      irr: irr(flows, { asOf, residualValue: unrealized }),
      // An LP interest in an SPV holding a SAFE is, economically, a SAFE
      // position: the underlying is what the list should show.
      instruments: [
        ...new Set(
          company.positions.map(
            (position) => position.underlyingInstrument ?? position.instrumentType,
          ),
        ),
      ],
      positionCount: company.positions.length,
      investmentGroups: [
        ...new Set(
          company.positions
            .map((position) => position.investmentGroup)
            .filter((group): group is string => !!group),
        ),
      ],
      firstInvestmentAt,
      lastUpdateAt: lastUpdate?.receivedAt ?? null,
      trend: computeTrend(
        {
          metrics: metricsByCompany.get(company.id) ?? [],
          signals: [
            ...(signalsByCompany.get(company.id) ?? []),
            // Deterministic signals describe the company as of now, so they are
            // dated now rather than by any email.
            // A deterministic signal carries its own polarity by kind, so
            // direction is not consulted for it.
            ...derived.map((signal) => ({
              kind: signal.kind,
              severity: signal.severity,
              direction: "NEUTRAL",
              derivedKind: signal.kind,
              at: asOf,
            })),
          ],
        },
        asOf,
      ),
      signals: derived,
    };
  });
}

export interface PortfolioTotals {
  /// Total cash out, fees included: what actually left the account.
  deployed: number;
  /// The part of it that bought ownership.
  invested: number;
  /// The part that did not.
  fees: number;
  realized: number;
  unrealized: number;
  totalValue: number;
  moic: number | null;
  companyCount: number;
  activeCount: number;
  deadCount: number;
  exitedCount: number;
  /// Companies with nothing left running, however their positions ended.
  /// Counted apart from the live ones: a closed position is not exposure, and
  /// calling it active overstates how many bets are in play.
  closedCount: number;
}

export function rollUp(summaries: CompanySummary[]): PortfolioTotals {
  const deployed = summaries.reduce((total, c) => total + c.deployed, 0);
  const fees = summaries.reduce((total, c) => total + c.fees, 0);
  const invested = summaries.reduce((total, c) => total + c.invested, 0);
  const realized = summaries.reduce((total, c) => total + c.realized, 0);
  const unrealized = summaries.reduce((total, c) => total + c.unrealized, 0);

  return {
    deployed,
    invested,
    fees,
    realized,
    unrealized,
    totalValue: realized + unrealized,
    moic: deployed > 0 ? (realized + unrealized) / deployed : null,
    companyCount: summaries.length,
    activeCount: summaries.filter((c) => c.status === "ACTIVE" && !c.closed).length,
    deadCount: summaries.filter((c) => c.status === "SHUT_DOWN").length,
    exitedCount: summaries.filter((c) => c.status === "ACQUIRED" || c.status === "IPO").length,
    closedCount: summaries.filter((c) => c.closed).length,
  };
}

/// Concentration by an arbitrary bucket (sector, vintage year, stage), largest
/// first. A power-law portfolio hides its risk in these buckets.
export function concentration(
  summaries: CompanySummary[],
  bucket: (company: CompanySummary) => string,
): { label: string; deployed: number; share: number }[] {
  const totals = new Map<string, number>();
  for (const company of summaries) {
    const label = bucket(company) || "Unspecified";
    totals.set(label, (totals.get(label) ?? 0) + company.deployed);
  }
  const grand = [...totals.values()].reduce((total, value) => total + value, 0);

  return [...totals.entries()]
    .map(([label, deployed]) => ({
      label,
      deployed,
      share: grand > 0 ? deployed / grand : 0,
    }))
    .sort((a, b) => b.deployed - a.deployed);
}

export async function getCompanyDetail(userId: string, companyId: string) {
  return prisma.company.findFirst({
    where: { id: companyId, userId },
    include: {
      contacts: true,
      positions: {
        include: { transactions: { orderBy: { date: "asc" } }, documents: true },
        orderBy: { investmentDate: "asc" },
      },
      valuations: { orderBy: { date: "desc" } },
      updates: {
        orderBy: { receivedAt: "desc" },
        include: { metrics: true, signals: true, actionItems: true },
      },
      actionItems: { orderBy: [{ state: "asc" }, { dueDate: "asc" }] },
      payments: { orderBy: { valueDate: "desc" } },
      claims: true,
      documents: true,
    },
  });
}
