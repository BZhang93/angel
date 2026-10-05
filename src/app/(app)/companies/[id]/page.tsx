import Link from "next/link";
import { notFound } from "next/navigation";
import {
  Card,
  ControlRow,
  CONTROL_SECONDARY,
  Pill,
  SeverityBadge,
  TrendIndicator,
} from "@/components/ui";
import { ActionForm, Checkbox, Field, Select } from "@/components/forms";
import {
  ACTION_KIND_OPTIONS,
  HOLDING_ENTITY_OPTIONS,
  INSTRUMENT_OPTIONS,
  STATUS_OPTIONS,
  UNDERLYING_OPTIONS,
  TRANSACTION_OPTIONS,
  VALUATION_SOURCE_OPTIONS,
} from "@/lib/enums";
import { getCompanyDetail, getCompanySummaries } from "@/lib/data/portfolio";
import { money, multiple, percent, shortDate, titleCase } from "@/lib/format";
import { ingestIssueNotice } from "@/lib/ingest-issue";
import { requireUserId } from "@/lib/session";
import { signedUrl } from "@/lib/storage";
import { ScanUpdatesButton } from "../../updates/scan-updates-button";
import { UploadDocument } from "./upload-document";
import { DocumentActions } from "./document-actions";
import { addYears } from "@/lib/signals";
import { findDiscrepancies, type Claim } from "@/lib/discrepancies";
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

  // Signed links are minted per render and expire in minutes: the bucket is
  // private, and a URL that outlives the page is a leak waiting to happen.
  const documentLinks = await Promise.all(
    company.documents.map(async (document) => ({
      ...document,
      href: document.storagePath ? await signedUrl(document.storagePath) : null,
    })),
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-baseline gap-3">
            <h1 className="text-lg font-semibold">{company.name}</h1>
            {summary && <TrendIndicator trend={summary.trend.trend} />}
          </div>
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
        <ControlRow>
          <ScanUpdatesButton companyId={company.id} />
          <form action={updateCompanyStatus} className="flex items-center gap-2">
            <input type="hidden" name="id" value={company.id} />
            {/* Labelled by aria rather than a stacked <label>: a label above one
                control makes it taller than its neighbours and breaks the row. */}
            <select
              name="status"
              aria-label="Company status"
              defaultValue={company.status}
              className={CONTROL_SECONDARY}
            >
              {STATUS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <button type="submit" className={CONTROL_SECONDARY}>
              Update
            </button>
          </form>
        </ControlRow>
      </div>

      {company.notes && (
        <p className="rounded-lg border border-border bg-surface px-4 py-3 text-sm text-muted">
          {company.notes}
        </p>
      )}

      {summary && summary.positionCount === 0 && (
        <p className="rounded-lg border border-dashed border-border px-4 py-3 text-sm text-muted">
          No position recorded yet, so this company has no deployed capital, MOIC or IRR. The
          emails proved you are an investor but never stated an amount. Add the cheque under
          Positions below.
        </p>
      )}

      {summary && summary.positionCount > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
          {[
            { label: "Deployed", value: money(summary.deployed) },
            { label: "Fees", value: money(summary.fees) },
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

      {summary && (
        <Card title="Trend">
          <div className="flex flex-wrap items-baseline gap-3">
            <TrendIndicator trend={summary.trend.trend} />
            <span className="text-sm text-muted">
              {summary.trend.evidence.length === 0
                ? "Nothing reported recently, so there is no direction to read."
                : "From reported growth and the last 90 days of signals."}
            </span>
          </div>
          {summary.trend.evidence.length > 0 && (
            /// Every number in this app traces to what it came from, and a
            /// derived one has to show its working or it is just an opinion.
            <ul className="mt-3 space-y-1 text-sm">
              {summary.trend.evidence.slice(0, 6).map((entry, index) => (
                <li key={`${entry.label}-${index}`} className="flex items-baseline gap-2">
                  <span
                    className={`tabular w-12 shrink-0 text-right ${entry.weight > 0 ? "text-positive" : "text-negative"}`}
                  >
                    {entry.weight > 0 ? "+" : ""}
                    {entry.weight.toFixed(2)}
                  </span>
                  <span className="text-muted">{entry.label}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
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
              // Every source's statement about this position, compared. The
              // point is to name the one that disagrees, not just to flag it.
              const claims: Claim[] = company.claims
                .filter((claim) => claim.positionId === position.id)
                .map((claim) => ({
                  source: claim.source,
                  kind: claim.kind,
                  amount: Number(claim.amount.toString()),
                }));
              const discrepancies = findDiscrepancies(claims);

              const invested = position.transactions
                .filter((t) => ["INVESTMENT", "CAPITAL_CALL", "FEE"].includes(t.kind))
                .reduce((total, t) => total + Number(t.amount.toString()), 0);

              const terms: [string, string][] = [
                ["Entity", titleCase(position.holdingEntity)],
                [
                  "Underlying",
                  position.underlyingInstrument
                    ? titleCase(position.underlyingInstrument)
                    : position.investmentGroup
                      ? "Not stated"
                      : "Held directly",
                ],
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
                      <h3 className="text-sm font-semibold">
                        {titleCase(position.instrumentType)}
                        {position.underlyingInstrument && (
                          <span className="font-normal text-muted">
                            {" "}
                            holding {titleCase(position.underlyingInstrument)}
                          </span>
                        )}
                      </h3>
                      {position.investmentGroup && (
                        <Link
                          href="/vehicles"
                          className="rounded border border-border px-1.5 py-0.5 text-[11px] text-muted hover:text-foreground"
                        >
                          via {position.investmentGroup}
                        </Link>
                      )}
                      {position.convertedIntoId && <Pill>Converted</Pill>}
                      {discrepancies.length > 0 && (
                        <span
                          title={discrepancies
                            .map((entry) => `${entry.label}. ${entry.detail}`)
                            .join("\n")}
                          className="inline-flex cursor-help items-center rounded border border-warn/30 bg-warn/10 px-1.5 py-0.5 text-[11px] font-medium uppercase tracking-wide text-warn"
                        >
                          Needs Review
                        </span>
                      )}
                    </div>
                    <span className="tabular text-sm text-muted">{money(invested)} in</span>
                  </div>

                  {discrepancies.length > 0 && (
                    <ul className="mt-2 space-y-0.5">
                      {discrepancies.map((entry, index) => (
                        <li key={index} className="text-xs text-warn">
                          {entry.label}. {entry.detail}
                        </li>
                      ))}
                    </ul>
                  )}

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
                <Select
                  label="Vehicle holds"
                  name="underlyingInstrument"
                  options={UNDERLYING_OPTIONS}
                />
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

      {company.payments.length > 0 && (
        <Card title="Bank Transfers">
          <ul className="divide-y divide-border">
            {company.payments.map((payment) => (
              <li key={payment.id} className="flex items-start justify-between gap-3 py-2">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="tabular text-sm font-medium">
                      {money(Number(payment.amount.toString()))}
                    </span>
                    <Pill>
                      {payment.state === "CONFIRMED"
                        ? "Confirms the investment"
                        : payment.state === "DISCREPANCY"
                          ? "Does not match"
                          : titleCase(payment.state)}
                    </Pill>
                    {payment.beneficiary && (
                      <span className="truncate text-xs text-muted">to {payment.beneficiary}</span>
                    )}
                  </div>
                  {payment.note && (
                    <p
                      className={`mt-0.5 text-sm ${payment.state === "DISCREPANCY" ? "text-warn" : "text-muted"}`}
                    >
                      {payment.note}
                    </p>
                  )}
                </div>
                <span className="shrink-0 text-xs text-muted">{shortDate(payment.valueDate)}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card title="Documents">
        {documentLinks.length === 0 ? (
          <p className="py-2 text-sm text-muted">
            No documents yet. Signed SAFEs, side letters and tax forms arrive as email
            attachments; investment memos and call recordings are fetched from links in those
            emails. You can also upload one below.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {documentLinks.map((document) => (
              <li key={document.id} className="flex items-start justify-between gap-3 py-2">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    {document.sourceUrl ? (
                      <a
                        href={document.sourceUrl}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="truncate text-sm font-medium hover:underline"
                      >
                        {document.title}
                      </a>
                    ) : document.href ? (
                      <a
                        href={document.href}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="truncate text-sm font-medium hover:underline"
                      >
                        {document.title}
                      </a>
                    ) : (
                      <span className="truncate text-sm font-medium">{document.title}</span>
                    )}
                    <Pill>{titleCase(document.kind)}</Pill>
                    {!document.storagePath && !document.sourceUrl && <Pill>not downloaded</Pill>}
                    {document.sourceUrl && <Pill>from a link</Pill>}
                  </div>
                  {document.summary && (
                    <p className="mt-0.5 text-sm text-muted">{document.summary}</p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <span className="tabular text-xs text-muted">
                    {document.sizeBytes ? `${Math.round(document.sizeBytes / 1024)} KB` : ""}
                  </span>
                  <DocumentActions id={document.id} canReread={!!document.storagePath} />
                </div>
              </li>
            ))}
          </ul>
        )}
        <UploadDocument companyId={company.id} />
      </Card>

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
                {update.ingestIssue != null && (
                  <p className="mt-1.5 rounded border border-border px-2 py-1.5 text-xs text-muted">
                    <span className="font-medium text-foreground">
                      {ingestIssueNotice(update.ingestIssue).label}.
                    </span>{" "}
                    {ingestIssueNotice(update.ingestIssue).detail}
                  </p>
                )}
                {update.links.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
                    {update.links.slice(0, 6).map((link) => (
                      <a
                        key={link}
                        href={link}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="max-w-full truncate text-xs text-muted underline hover:text-foreground"
                      >
                        {link.replace(/^https?:\/\/(www\.)?/, "")}
                      </a>
                    ))}
                  </div>
                )}
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
