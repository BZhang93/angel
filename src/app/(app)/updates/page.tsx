import { Card, EmptyState, Pill } from "@/components/ui";
import { prisma } from "@/lib/prisma";
import { shortDate } from "@/lib/format";
import { ingestIssueNotice } from "@/lib/ingest-issue";
import { groupPendingUpdates } from "@/lib/review-queue";
import { requireUserId } from "@/lib/session";
import { ReviewGroup } from "./review-group";
import { ReviewRow } from "./review-row";
import { ScanUpdatesButton } from "./scan-updates-button";

export default async function UpdatesPage() {
  const userId = await requireUserId();

  const [pending, companies] = await Promise.all([
    prisma.update.findMany({
      where: { userId, reviewState: "PENDING" },
      // Oldest first: the queue is a backlog, and grouping reorders it anyway.
      orderBy: { receivedAt: "asc" },
      take: 200,
    }),
    prisma.company.findMany({
      where: { userId },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  if (pending.length === 0) {
    return (
      <EmptyState
        title="Review Queue Is Empty"
        body="Updates whose sender does not clearly belong to a portfolio company land here for assignment."
      />
    );
  }

  const groups = groupPendingUpdates(
    pending,
    new Map(companies.map((company) => [company.id, company.name])),
  );
  const suggested = groups.filter((group) => group.companyId != null).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h1 className="text-lg font-semibold">Review Queue</h1>
        <ScanUpdatesButton />
      </div>
      <p className="text-sm text-muted">
        {pending.length} update{pending.length === 1 ? "" : "s"} could not be matched confidently,
        grouped by their suggested company and oldest first.{" "}
        {suggested > 0
          ? "Confirm a whole group at once, or assign a row on its own if it belongs elsewhere."
          : "Assign each to a company, which extracts it immediately."}
      </p>

      <div className="space-y-6">
        {groups.map((group) => (
          <ReviewGroup
            key={group.companyId ?? "unassigned"}
            companyId={group.companyId}
            companyName={group.companyName}
            items={group.items.map((update) => ({
              id: update.id,
              render: (
                <Card>
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="text-sm font-medium">{update.subject ?? "(no subject)"}</span>
                    <span className="text-xs text-muted">
                      {update.fromAddress} · {shortDate(update.receivedAt)}
                    </span>
                  </div>
                  {update.ingestIssue != null && (
                    <p className="mt-2 rounded border border-border bg-surface px-2 py-1.5 text-xs text-muted">
                      <span className="font-medium text-foreground">
                        {ingestIssueNotice(update.ingestIssue).label}.
                      </span>{" "}
                      {ingestIssueNotice(update.ingestIssue).detail}
                    </p>
                  )}
                  {update.ingestReason != null && (
                    /* Mail the user never filed has to say why it is here, or
                       the queue reads as the app having rummaged. */
                    <p className="mt-2 text-xs text-muted">
                      <span className="font-medium text-foreground">Found unlabelled:</span>{" "}
                      {update.ingestReason}
                    </p>
                  )}
                  {update.matchConfidence != null && (
                    <div className="mt-1">
                      <Pill>
                        Suggested match confidence{" "}
                        {Math.round(Number(update.matchConfidence.toString()) * 100)}%
                      </Pill>
                    </div>
                  )}
                  <p className="mt-2 line-clamp-4 whitespace-pre-wrap text-sm text-muted">
                    {update.rawText.slice(0, 600)}
                  </p>
                  <ReviewRow
                    updateId={update.id}
                    companies={companies}
                    suggestedCompanyId={update.companyId}
                  />
                </Card>
              ),
            }))}
          />
        ))}
      </div>
    </div>
  );
}
