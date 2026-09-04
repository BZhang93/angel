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
}

/// Everything the companies list and the dashboard need, in one query pass.
export async function getCompanySummaries(
  userId: string,
  asOf: Date = new Date(),
): Promise<CompanySummary[]> {
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

    const mark = {
      shareCount: shareCount > 0 ? shareCount : null,
      latestPricePerShare: latestPriced ? toNumber(latestPriced.pricePerShare) : null,
      companyIsDead,
    };

    const unrealized = unrealizedValue(flows, mark);
    const lastUpdate = company.updates[0] ?? null;
    const runwayMetric = lastUpdate?.metrics[0] ?? null;
    const firstInvestmentAt = company.positions.reduce<Date | null>(
      (earliest, position) =>
        !earliest || position.investmentDate < earliest ? position.investmentDate : earliest,
      null,
    );

    return {
      id: company.id,
      name: company.name,
      website: company.website,
      sector: company.sector,
      status: company.status,
      stage: company.stage,
      deployed: totalDeployed(flows),
      invested: costBasis(flows),
      fees: round2(totalDeployed(flows) - costBasis(flows)),
      realized: totalRealized(flows),
      unrealized,
      moic: moic(flows, mark),
      irr: irr(flows, { asOf, residualValue: unrealized }),
      instruments: [...new Set(company.positions.map((position) => position.instrumentType))],
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
      signals: deriveCompanySignals(
        {
          lastUpdateAt: lastUpdate?.receivedAt ?? null,
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
      ),
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
    activeCount: summaries.filter((c) => c.status === "ACTIVE").length,
    deadCount: summaries.filter((c) => c.status === "SHUT_DOWN").length,
    exitedCount: summaries.filter((c) => c.status === "ACQUIRED" || c.status === "IPO").length,
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
