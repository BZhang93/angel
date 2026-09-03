import { Card, Pill } from "@/components/ui";
import { prisma } from "@/lib/prisma";
import { aiConfigured } from "@/lib/ai/client";
import { googleOAuthConfigured } from "@/lib/gmail/client";
import { shortDate } from "@/lib/format";
import { requireUserId } from "@/lib/session";
import { SyncPanel } from "./sync-panel";

export default async function SettingsPage({ searchParams }: PageProps<"/settings">) {
  const userId = await requireUserId();
  const params = await searchParams;
  const error = typeof params.error === "string" ? params.error : null;

  const [account, pendingCount] = await Promise.all([
    prisma.gmailAccount.findUnique({ where: { userId } }),
    prisma.update.count({ where: { userId, reviewState: "PENDING" } }),
  ]);

  return (
    <div className="max-w-3xl space-y-4">
      <h1 className="text-lg font-semibold">Settings</h1>

      <Card title="Gmail">
        {!googleOAuthConfigured() ? (
          <p className="text-sm text-muted">
            Google OAuth is not configured on this deployment. Set GOOGLE_CLIENT_ID and
            GOOGLE_CLIENT_SECRET, then reload.
          </p>
        ) : account ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-medium">{account.emailAddress}</span>
              <Pill>Connected</Pill>
              <span className="text-muted">
                Last synced {account.lastSyncedAt ? shortDate(account.lastSyncedAt) : "never"}
              </span>
            </div>
            <SyncPanel syncQuery={account.syncQuery} pendingCount={pendingCount} />
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-sm text-muted">
              Read-only access to Gmail, restricted to the messages your sync query matches.
            </p>
            <a
              href="/api/gmail/connect"
              className="inline-block rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white"
            >
              Connect Gmail
            </a>
          </div>
        )}
        {error && <p className="mt-3 text-sm text-negative">{error}</p>}
      </Card>

      <Card title="Extraction">
        <p className="text-sm text-muted">
          {aiConfigured()
            ? "Claude is configured. Update bodies are sent to Anthropic when an update is extracted; keep the sync query narrow so unrelated mail is never ingested."
            : "No Claude credentials found, so updates are stored but not extracted. Set ANTHROPIC_API_KEY, or run `ant auth login` for local development."}
        </p>
      </Card>
    </div>
  );
}
