import "server-only";
import { prisma } from "@/lib/prisma";
import { totalDeployed, totalRealized, type CashKind, type Cashflow } from "@/lib/portfolio";

// Investments grouped by the vehicle they were made through.
//
// A syndicate or SPV manager is not a portfolio company: you have no exposure
// to Viaka, you have exposure to the companies its SPVs hold. But the vehicle
// is how the money was routed, what charges the fees, and who to chase for a
// K-1, so it deserves a view of its own.

export interface VehicleHolding {
  companyId: string;
  companyName: string;
  status: string;
  /// The vehicle took the money and gave it back: the deal never happened.
  refunded: boolean;
  deployed: number;
  fees: number;
  realized: number;
  investmentDate: Date;
  /// What the vehicle holds in the company, when known.
  underlyingInstrument: string | null;
}

export interface VehicleSummary {
  name: string;
  holdings: VehicleHolding[];
  deployed: number;
  fees: number;
  realized: number;
  /// Fees as a share of everything routed through the vehicle, which is the
  /// number that says what the wrapper costs.
  feeRate: number | null;
  firstInvestmentAt: Date | null;
  lastInvestmentAt: Date | null;
}

function toNumber(value: unknown): number {
  if (value == null) return 0;
  return typeof value === "number" ? value : Number(value.toString());
}

export async function getVehicles(userId: string): Promise<VehicleSummary[]> {
  const positions = await prisma.position.findMany({
    where: { userId, investmentGroup: { not: null } },
    include: {
      transactions: true,
      company: { select: { id: true, name: true, status: true } },
    },
    orderBy: { investmentDate: "asc" },
  });

  const byVehicle = new Map<string, VehicleHolding[]>();

  for (const position of positions) {
    const flows: Cashflow[] = position.transactions.map((transaction) => ({
      kind: transaction.kind as CashKind,
      amount: toNumber(transaction.amount),
      date: transaction.date,
    }));

    const deployed = totalDeployed(flows);
    const invested = flows
      .filter((flow) => flow.kind === "INVESTMENT" || flow.kind === "CAPITAL_CALL")
      .reduce((total, flow) => total + flow.amount, 0);

    const holding: VehicleHolding = {
      companyId: position.company.id,
      companyName: position.company.name,
      status: position.company.status,
      refunded: position.status === "REFUNDED",
      deployed,
      fees: round2(deployed - invested),
      realized: totalRealized(flows),
      investmentDate: position.investmentDate,
      underlyingInstrument: position.underlyingInstrument,
    };

    const name = position.investmentGroup!;
    byVehicle.set(name, [...(byVehicle.get(name) ?? []), holding]);
  }

  return [...byVehicle.entries()]
    .map(([name, holdings]) => {
      const deployed = holdings.reduce((total, holding) => total + holding.deployed, 0);
      const fees = holdings.reduce((total, holding) => total + holding.fees, 0);
      const dates = holdings.map((holding) => holding.investmentDate.getTime());

      return {
        name,
        holdings: [...holdings].sort(
          (a, b) => b.investmentDate.getTime() - a.investmentDate.getTime(),
        ),
        deployed,
        fees,
        realized: holdings.reduce((total, holding) => total + holding.realized, 0),
        feeRate: deployed > 0 ? fees / deployed : null,
        firstInvestmentAt: dates.length > 0 ? new Date(Math.min(...dates)) : null,
        lastInvestmentAt: dates.length > 0 ? new Date(Math.max(...dates)) : null,
      };
    })
    .sort((a, b) => b.deployed - a.deployed);
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
