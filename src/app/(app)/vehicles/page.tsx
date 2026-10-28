import Link from "next/link";
import { Card, EmptyState, Pill } from "@/components/ui";
import { getVehicles } from "@/lib/data/vehicles";
import { money, percent, shortDate, titleCase } from "@/lib/format";
import { requireUserId } from "@/lib/session";

export default async function VehiclesPage() {
  const userId = await requireUserId();
  const vehicles = await getVehicles(userId);

  if (vehicles.length === 0) {
    return (
      <EmptyState
        title="No Vehicles Yet"
        body="Syndicates, SPVs and funds appear here once an investment records one. A direct investment has no vehicle."
      />
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-lg font-semibold">Vehicles</h1>
        <p className="mt-1 text-sm text-muted">
          The syndicates and SPVs your money was routed through. A vehicle is not a portfolio
          company: your exposure is to what it holds. It is, however, what charges the fees and
          who to chase for a K-1.
        </p>
      </div>

      {vehicles.map((vehicle) => (
        <Card key={vehicle.name} title={vehicle.name}>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { label: "Deployed", value: money(vehicle.deployed) },
              { label: "Fees", value: money(vehicle.fees) },
              {
                label: "Fee rate",
                value: percent(vehicle.feeRate),
              },
              {
                label: "Investments",
                value: `${vehicle.holdings.length}`,
              },
            ].map((stat) => (
              <div key={stat.label} className="rounded-md border border-border px-3 py-2">
                <div className="text-xs uppercase tracking-wide text-muted">{stat.label}</div>
                <div className="tabular mt-0.5 text-lg font-semibold">{stat.value}</div>
              </div>
            ))}
          </div>

          <table className="mt-4 w-full text-sm">
            <thead className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="py-2 font-medium">Company</th>
                <th className="py-2 font-medium">Holds</th>
                <th className="py-2 text-right font-medium">Deployed</th>
                <th className="py-2 text-right font-medium">Fees</th>
                <th className="py-2 text-right font-medium">Date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {vehicle.holdings.map((holding) => (
                <tr key={`${holding.companyId}-${holding.investmentDate.toISOString()}`}>
                  <td className="py-2">
                    <Link href={`/companies/${holding.companyId}`} className="hover:underline">
                      {holding.companyName}
                    </Link>
                    {holding.refunded && (
                      <span className="ml-2 text-xs text-muted">refunded</span>
                    )}
                  </td>
                  <td className="py-2">
                    {holding.underlyingInstrument ? (
                      <Pill>{titleCase(holding.underlyingInstrument)}</Pill>
                    ) : (
                      <span className="text-xs text-muted">not stated</span>
                    )}
                  </td>
                  <td className="tabular py-2 text-right">{money(holding.deployed)}</td>
                  <td className="tabular py-2 text-right text-muted">
                    {holding.fees > 0 ? money(holding.fees) : "—"}
                  </td>
                  <td className="py-2 text-right text-muted">
                    {shortDate(holding.investmentDate)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ))}
    </div>
  );
}
