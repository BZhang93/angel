import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, Pill, SeverityBadge } from "@/components/ui";
import { ActionForm, Checkbox, Field, Select } from "@/components/forms";
import {
  ACTION_KIND_OPTIONS,
  HOLDING_ENTITY_OPTIONS,
  INSTRUMENT_OPTIONS,
  STATUS_OPTIONS,
  TRANSACTION_OPTIONS,
  VALUATION_SOURCE_OPTIONS,
} from "@/lib/enums";
import { getCompanyDetail, getCompanySummaries } from "@/lib/data/portfolio";
import { money, multiple, percent, shortDate, titleCase } from "@/lib/format";
import { requireUserId } from "@/lib/session";
import { addYears } from "@/lib/signals";
import {
  addActionItem,
  addPosition,
  addTransaction,
  addValuation,
  completeActionItem,
  updateCompanyStatus,
} from "../actions";

function num(value: unknown): number | null {
  if (value == null) return null;
  return Number(value.toString());
}

export default async function CompanyPage({ params }: PageProps<"/companies/[id]">) {
  const { id } = await params;
  const userId = await requireUserId();
  const company = await getCompanyDetail(userId, id);
  if (!company) notFound();

  // The summary carries the computed numbers and the derived signals, so the
  // detail page never re-implements the maths.
  const summary = (await getCompanySummaries(userId)).find((entry) => entry.id === id);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">{company.name}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted">
            {company.website && (
              <a
                href={company.website}
                target="_blank"
                rel="noreferrer noopener"
                className="hover:text-foreground hover:underline"
              >
                {company.website.replace(/^https?:\/\//, "")}
              </a>
            )}
            <Pill>{titleCase(company.status)}</Pill>
            <Pill>{titleCase(company.stage)}</Pill>
            {company.sector && <Pill>{company.sector}</Pill>}
          </div>
        </div>
        <form action={updateCompanyStatus} className="flex items-end gap-2">
          <input type="hidden" name="id" value={company.id} />
          <label className="text-sm">
            <span className="text-muted">Status</span>
            <select
              name="status"
              defaultValue={company.status}
              className="mt-1 block rounded-md border border-border bg-surface px-3 py-1.5"
            >
              {STATUS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className="rounded-md border border-border px-3 py-1.5 text-sm">
            Update
          </button>
        </form>
      </div>

      {summary && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {[
            { label: "Deployed", value: money(summary.deployed) },
            { label: "Realized", value: money(summary.realized) },
            { label: "Unrealized", value: money(summary.unrealized) },
            { label: "MOIC", value: multiple(summary.moic) },
            { label: "IRR", value: percent(summary.irr) },
          ].map((stat) => (
            <div key={stat.label} className="rounded-lg border border-border bg-surface px-3 py-2">
              <div className="text-xs uppercase tracking-wide text-muted">{stat.label}</div>
              <div className="tabular mt-0.5 text-lg font-semibold">{stat.value}</div>
            </div>
          ))}
        </div>
      )}

      {summary && summary.signals.length > 0 && (
        <Card title="Risk Flags">
          <ul className="space-y-2">
            {summary.signals.map((signal, index) => (
              <li key={`${signal.kind}-${index}`} className="flex items-start gap-2 text-sm">
                <SeverityBadge severity={signal.severity} />
                <span>{signal.summary}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card title="Positions">
        {company.positions.length === 0 ? (
          <p className="py-2 text-sm text-muted">No positions recorded yet.</p>
        ) : (
          <div className="space-y-4">
            {company.positions.map((position) => {
              const invested = position.transactions
                .filter((t) => ["INVESTMENT", "CAPITAL_CALL", "FEE"].includes(t.kind))
                .reduce((total, t) => total + Number(t.amount.toString()), 0);

              const terms: [string, string][] = [
                ["Entity", titleCase(position.holdingEntity)],
                ["Invested", shortDate(position.investmentDate)],
                ["Cap", money(num(position.valuationCap))],
                ["Discount", position.discountPct ? `${num(position.discountPct)}%` : "—"],
                ["Structure", position.safeIsPostMoney == null ? "—" : position.safeIsPostMoney ? "Post-money" : "Pre-money"],
                ["Interest", position.interestRatePct ? `${num(position.interestRatePct)}%` : "—"],
                ["Maturity", shortDate(position.maturityDate)],
                ["Shares", position.shareCount ? num(position.shareCount)!.toLocaleString() : "—"],
                ["Share class", position.shareClass ?? "—"],
                ["Ownership", position.ownershipPct ? `${num(position.ownershipPct)}%` : "—"],
                ["Pro rata", position.hasProRata ? "Yes" : "No"],
                [
                  "QSBS",
                  position.qsbsEligible
                    ? `Eligible from ${shortDate(addYears(position.investmentDate, 5))}`
                    : "Not eligible",
                ],
              ];

              return (
                <div key={position.id} className="rounded-md border border-border p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-semibold">{titleCase(position.instrumentType)}</h3>
                      {position.investmentGroup && <Pill>via {position.investmentGroup}</Pill>}
                      {position.convertedIntoId && <Pill>Converted</Pill>}
                    </div>
                    <span className="tabular text-sm text-muted">{money(invested)} in</span>
                  </div>

                  <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
                    {terms.map(([label, value]) => (
                      <div key={label}>
                        <dt className="text-xs text-muted">{label}</dt>
                        <dd className="tabular">{value}</dd>
                      </div>
                    ))}
                  </dl>

                  {position.transactions.length > 0 && (
                    <table className="mt-3 w-full text-sm">
                      <tbody className="divide-y divide-border">
                        {position.transactions.map((transaction) => (
                          <tr key={transaction.id}>
                            <td className="py-1 text-muted">{shortDate(transaction.date)}</td>
                            <td className="py-1">{titleCase(transaction.kind)}</td>
                            <td className="tabular py-1 text-right">
                              {money(Number(transaction.amount.toString()))}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}

                  <details className="mt-3">
                    <summary className="cursor-pointer text-xs text-muted">Add Transaction</summary>
                    <div className="mt-2">
                      <ActionForm action={addTransaction} submitLabel="Add" compact>
                        <input type="hidden" name="positionId" value={position.id} />
                        <div className="grid gap-2 sm:grid-cols-3">
                          <Select label="Kind" name="kind" options={TRANSACTION_OPTIONS} />
                          <Field label="Amount" name="amount" type="number" required />
                          <Field label="Date" name="date" type="date" required />
                        </div>
                      </ActionForm>
                    </div>
                  </details>
                </div>
              );
            })}
          </div>
        )}

        <details className="mt-4">
          <summary className="cursor-pointer text-sm text-muted">Add Another Position</summary>
          <div className="mt-3">
            <ActionForm action={addPosition} submitLabel="Add Position">
              <input type="hidden" name="companyId" value={company.id} />
              <div className="grid gap-3 sm:grid-cols-3">
                <Select label="Instrument" name="instrumentType" options={INSTRUMENT_OPTIONS} />
                <Select label="Holding entity" name="holdingEntity" options={HOLDING_ENTITY_OPTIONS} />
                <Field label="Amount" name="amount" type="number" />
                <Field label="Investment date" name="investmentDate" type="date" required />
                <Field label="Valuation cap" name="valuationCap" type="number" />
                <Field label="Discount %" name="discountPct" type="number" />
                <Field label="Interest rate %" name="interestRatePct" type="number" />
                <Field label="Maturity date" name="maturityDate" type="date" />
                <Field label="Share class" name="shareClass" />
                <Field label="Share count" name="shareCount" type="number" />
                <Field label="Price per share" name="pricePerShare" type="number" />
                <Field label="Ownership %" name="ownershipPct" type="number" />
              </div>
              <div className="flex gap-6">
                <Checkbox label="Pro rata side letter" name="hasProRata" />
                <Checkbox label="QSBS eligible" name="qsbsEligible" />
              </div>
            </ActionForm>
          </div>
        </details>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Marks">
          {company.valuations.length === 0 ? (
            <p className="py-2 text-sm text-muted">
              No marks recorded. Positions are carried at cost until one is added.
            </p>
          ) : (
            <table className="w-full text-sm">
              <tbody className="divide-y divide-border">
                {company.valuations.map((valuation) => (
                  <tr key={valuation.id}>
                    <td className="py-1 text-muted">{shortDate(valuation.date)}</td>
                    <td className="py-1">{titleCase(valuation.source)}</td>
                    <td className="tabular py-1 text-right">
                      {money(num(valuation.postMoneyValuation), { compact: true })}
                    </td>
                    <td className="tabular py-1 text-right text-muted">
                      {valuation.pricePerShare ? `$${num(valuation.pricePerShare)}/sh` : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <details className="mt-3">
            <summary className="cursor-pointer text-xs text-muted">Add Mark</summary>
            <div className="mt-2">
              <ActionForm action={addValuation} submitLabel="Add Mark" compact>
                <input type="hidden" name="companyId" value={company.id} />
                <div className="grid gap-2 sm:grid-cols-2">
                  <Field label="Date" name="date" type="date" required />
                  <Select label="Source" name="source" options={VALUATION_SOURCE_OPTIONS} />
                  <Field label="Post-money valuation" name="postMoneyValuation" type="number" />
                  <Field label="Price per share" name="pricePerShare" type="number" />
                </div>
              </ActionForm>
            </div>
          </details>
        </Card>

        <Card title="Action Items">
          {company.actionItems.length === 0 ? (
            <p className="py-2 text-sm text-muted">Nothing outstanding.</p>
          ) : (
            <ul className="divide-y divide-border">
              {company.actionItems.map((item) => (
                <li key={item.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <div>
                    <span className={item.state === "DONE" ? "line-through text-muted" : ""}>
                      {item.title}
                    </span>
                    <div className="text-xs text-muted">
                      {titleCase(item.kind)}
                      {item.dueDate ? ` · due ${shortDate(item.dueDate)}` : ""}
                    </div>
                  </div>
                  {item.state === "OPEN" && (
                    <form action={completeActionItem}>
                      <input type="hidden" name="id" value={item.id} />
                      <button type="submit" className="text-xs text-muted hover:text-foreground">
                        Done
                      </button>
                    </form>
                  )}
                </li>
              ))}
            </ul>
          )}

          <details className="mt-3">
            <summary className="cursor-pointer text-xs text-muted">Add Action Item</summary>
            <div className="mt-2">
              <ActionForm action={addActionItem} submitLabel="Add" compact>
                <input type="hidden" name="companyId" value={company.id} />
                <div className="grid gap-2 sm:grid-cols-2">
                  <Field label="Title" name="title" required />
                  <Select label="Kind" name="kind" options={ACTION_KIND_OPTIONS} />
                  <Field label="Due date" name="dueDate" type="date" />
                  <Field label="Detail" name="detail" />
                </div>
              </ActionForm>
            </div>
          </details>
        </Card>
      </div>

      <Card title="Updates">
        {company.updates.length === 0 ? (
          <p className="py-2 text-sm text-muted">
            No investor updates yet. Connect Gmail in{" "}
            <Link href="/settings" className="underline">
              settings
            </Link>{" "}
            to ingest them automatically.
          </p>
        ) : (
          <ul className="space-y-4">
            {company.updates.map((update) => (
              <li key={update.id} className="border-b border-border pb-4 last:border-0">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-sm font-medium">{update.subject ?? "(no subject)"}</span>
                  <span className="text-xs text-muted">{shortDate(update.receivedAt)}</span>
                </div>
                {update.summary && <p className="mt-1 text-sm text-muted">{update.summary}</p>}
                {update.metrics.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {update.metrics.map((metric) => (
                      <Pill key={metric.id}>
                        {titleCase(metric.key)} {Number(metric.value.toString()).toLocaleString()}
                        {metric.periodLabel ? ` · ${metric.periodLabel}` : ""}
                      </Pill>
                    ))}
                  </div>
                )}
                {update.signals.length > 0 && (
                  <ul className="mt-2 space-y-1">
                    {update.signals.map((signal) => (
                      <li key={signal.id} className="flex items-start gap-2 text-sm">
                        <SeverityBadge severity={signal.severity} />
                        <span>
                          {signal.summary}
                          {signal.sourceQuote && (
                            <span className="mt-0.5 block border-l-2 border-border pl-2 text-xs italic text-muted">
                              {signal.sourceQuote}
                            </span>
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
