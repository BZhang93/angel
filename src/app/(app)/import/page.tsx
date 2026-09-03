import { Card, EmptyState, Pill } from "@/components/ui";
import { prisma } from "@/lib/prisma";
import { parseProposal } from "@/lib/import/accept";
import { money, shortDate, titleCase } from "@/lib/format";
import { requireUserId } from "@/lib/session";
import { CandidateCard } from "./candidate-card";
import { ScanPanel } from "./scan-panel";

export default async function ImportPage() {
  const userId = await requireUserId();

  const [account, candidates, importedCount] = await Promise.all([
    prisma.gmailAccount.findUnique({ where: { userId } }),
    prisma.importCandidate.findMany({
      where: { userId, state: "PROPOSED" },
      orderBy: [{ confidence: "desc" }, { emailCount: "desc" }],
    }),
    prisma.importCandidate.count({ where: { userId, state: "IMPORTED" } }),
  ]);

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
      </div>

      <Card title="Scan">
        <ScanPanel
          defaultQuery={account.syncQuery}
          hasCandidates={candidates.length > 0}
          importedCount={importedCount}
        />
      </Card>

      {candidates.length === 0 ? (
        <EmptyState
          title="No Proposals Yet"
          body="Run a scan to read the mailbox. It takes a minute or two, and only reads what the query matches."
        />
      ) : (
        <div className="space-y-3">
          {candidates.map((candidate) => {
            const proposal = parseProposal(candidate.payload);
            if (!proposal) return null;

            return (
              <Card key={candidate.id}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-sm font-semibold">{proposal.name}</h2>
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

                <CandidateCard
                  id={candidate.id}
                  name={proposal.name}
                  website={proposal.website ?? `https://${candidate.sourceDomain}`}
                  sector={proposal.sector ?? ""}
                />
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
