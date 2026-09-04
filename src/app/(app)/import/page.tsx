import { Card, EmptyState, Pill } from "@/components/ui";
import { prisma } from "@/lib/prisma";
import { parseProposal, previewAccept } from "@/lib/import/accept";
import { isCompanyDomain } from "@/lib/import/domains";
import { normalizeCompanyName } from "@/lib/import/identity";
import { domainOfWebsite } from "@/lib/import/identity";
import { money, shortDate, titleCase } from "@/lib/format";
import { requireUserId } from "@/lib/session";
import { latestRun } from "@/lib/progress";
import { CandidateCard } from "./candidate-card";
import { ScanPanel } from "./scan-panel";
import { ScanProgress } from "./scan-progress";

export default async function ImportPage() {
  const userId = await requireUserId();

  const [account, candidates, importedCount, run, companyCount, pendingUpdates] = await Promise.all([
    prisma.gmailAccount.findUnique({ where: { userId } }),
    prisma.importCandidate.findMany({
      where: { userId, state: "PROPOSED" },
      orderBy: [{ proposedName: "asc" }, { confidence: "desc" }],
    }),
    prisma.importCandidate.count({ where: { userId, state: "IMPORTED" } }),
    latestRun(userId, "IMPORT_SCAN"),
    prisma.company.count({ where: { userId } }),
    prisma.update.count({ where: { userId, reviewState: "PENDING" } }),
  ]);
  const running = run?.state === "RUNNING";

  // The same company often arrives from two senders: the syndicate's own mail
  // and the bank transfer confirming it. Shown together rather than as two
  // unrelated cards, because importing both is the right move: one supplies the
  // terms, the other the amount.
  const siblingsByName = new Map<string, string[]>();
  for (const candidate of candidates) {
    const key = normalizeCompanyName(candidate.proposedName);
    siblingsByName.set(key, [...(siblingsByName.get(key) ?? []), candidate.sourceDomain]);
  }

  if (!account) {
    return (
      <EmptyState
        title="Connect Gmail First"
        body="The importer reads the mail you have already labelled and proposes the companies it finds."
        cta={{ href: "/settings", label: "Go to Settings" }}
      />
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-lg font-semibold">Import From Gmail</h1>
        <p className="mt-1 text-sm text-muted">
          Groups your labelled mail by sender company, keeps only the senders that show real
          evidence of an investment, and proposes each one with whatever terms the emails state.
          Nothing enters the portfolio until you accept it.
        </p>
        <p className="mt-2 text-sm text-muted">
          {companyCount === 0
            ? "You have no companies yet, so every proposal here creates one."
            : `You already have ${companyCount} compan${companyCount === 1 ? "y" : "ies"}, so a proposal that matches one is offered as a merge rather than a second entry.`}{" "}
          Accepting a proposal also files the emails behind it against that company and reads
          them{pendingUpdates > 0 ? `, which is what ${pendingUpdates} unmatched email${pendingUpdates === 1 ? " is" : "s are"} waiting for` : ""}.
        </p>
      </div>

      <Card title="Scan">
        <ScanProgress
          running={running}
          step={run?.step ?? null}
          doneItems={run?.doneItems ?? 0}
          totalItems={run?.totalItems ?? 0}
          produced={run?.produced ?? 0}
        />
        <div className={running ? "mt-3" : ""}>
        <ScanPanel
          defaultQuery={account.syncQuery}
          hasCandidates={candidates.length > 0}
          importedCount={importedCount}
          running={running}
        />
        </div>
      </Card>

      {candidates.length === 0 ? (
        running ? null : (
          <EmptyState
            title="No Proposals Yet"
            body="Run a scan to read the mailbox. It takes a minute or two, and only reads what the query matches."
          />
        )
      ) : (
        <div className="space-y-3">
          {await Promise.all(candidates.map(async (candidate) => {
            const proposal = parseProposal(candidate.payload);
            // A payload written by an older version of the extractor. Say so
            // rather than rendering nothing, which reads as a bug.
            if (!proposal) {
              return (
                <Card key={candidate.id}>
                  <p className="text-sm text-muted">
                    <span className="font-medium text-foreground">{candidate.proposedName}</span>{" "}
                    was proposed by an earlier version of the importer and can no longer be read.
                    Run Scan Mailbox again to rebuild it.
                  </p>
                </Card>
              );
            }

            const siblings = (siblingsByName.get(normalizeCompanyName(candidate.proposedName)) ?? [])
              .filter((domain) => domain !== candidate.sourceDomain);

            return (
              <Card key={candidate.id}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-sm font-semibold">{proposal.name}</h2>
                      {proposal.investmentGroup && (
                        <Pill>via {proposal.investmentGroup}</Pill>
                      )}
                      <Pill>{candidate.sourceDomain}</Pill>
                      <Pill>
                        {candidate.emailCount} email{candidate.emailCount === 1 ? "" : "s"}
                      </Pill>
                      <Pill>{Math.round(Number(candidate.confidence ?? 0) * 100)}% confident</Pill>
                    </div>
                    {proposal.description && (
                      <p className="mt-1 text-sm text-muted">{proposal.description}</p>
                    )}
                  </div>
                </div>

                {proposal.positions.length > 0 ? (
                  <ul className="mt-3 space-y-2">
                    {proposal.positions.map((position, index) => (
                      <li key={index} className="rounded-md border border-border px-3 py-2 text-sm">
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                          <span className="font-medium">{titleCase(position.instrumentType)}</span>
                          <span className="tabular">{money(position.amount)}</span>
                          <span className="text-muted">
                            {position.investmentDate
                              ? shortDate(new Date(`${position.investmentDate}T00:00:00.000Z`))
                              : "no date found"}
                          </span>
                          {position.valuationCap && (
                            <span className="text-muted">
                              cap {money(position.valuationCap, { compact: true })}
                            </span>
                          )}
                          {position.discountPct != null && (
                            <span className="text-muted">{position.discountPct}% discount</span>
                          )}
                          {position.feesAmount != null && position.feesAmount > 0 && (
                            <span className="text-muted">+ {money(position.feesAmount)} fees</span>
                          )}
                          {!position.amountConfirmed && (
                            <span className="text-warn">committed, wire unconfirmed</span>
                          )}
                        </div>
                        <p className="mt-1 border-l-2 border-border pl-2 text-xs italic text-muted">
                          {position.sourceQuote}
                        </p>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-3 text-sm text-muted">
                    No cheque found in these emails. The company imports without a position, and you
                    can add the amount by hand.
                  </p>
                )}

                {proposal.notes && (
                  <p className="mt-2 text-xs text-warn">{proposal.notes}</p>
                )}

                {siblings.length > 0 && (
                  <p className="mt-2 text-xs text-muted">
                    Also proposed from {siblings.join(", ")}. Import both: they combine into one
                    company, and one source usually supplies terms the other lacks.
                  </p>
                )}

                <CandidateCard
                  id={candidate.id}
                  name={proposal.name}
                  website={
                    isCompanyDomain(domainOfWebsite(proposal.website)) ? proposal.website! : ""
                  }
                  sector={proposal.sector ?? ""}
                  mergeHint={await previewAccept(userId, {
                    name: proposal.name,
                    website: isCompanyDomain(domainOfWebsite(proposal.website))
                      ? proposal.website
                      : null,
                  })}
                />
              </Card>
            );
          }))}
        </div>
      )}
    </div>
  );
}
