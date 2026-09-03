import { Card, EmptyState, Pill } from "@/components/ui";
import { prisma } from "@/lib/prisma";
import { shortDate } from "@/lib/format";
import { requireUserId } from "@/lib/session";
import { ReviewRow } from "./review-row";

export default async function UpdatesPage() {
  const userId = await requireUserId();

  const [pending, companies] = await Promise.all([
    prisma.update.findMany({
      where: { userId, reviewState: "PENDING" },
      orderBy: { receivedAt: "desc" },
      take: 50,
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

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">Review Queue</h1>
      <p className="text-sm text-muted">
        {pending.length} update{pending.length === 1 ? "" : "s"} could not be matched confidently.
        Assigning one extracts it immediately.
      </p>

      <div className="space-y-3">
        {pending.map((update) => (
          <Card key={update.id}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="text-sm font-medium">{update.subject ?? "(no subject)"}</span>
              <span className="text-xs text-muted">
                {update.fromAddress} · {shortDate(update.receivedAt)}
              </span>
            </div>
            {update.matchConfidence != null && (
              <div className="mt-1">
                <Pill>
                  Suggested match confidence {Math.round(Number(update.matchConfidence.toString()) * 100)}%
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
        ))}
      </div>
    </div>
  );
}
