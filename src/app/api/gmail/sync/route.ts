import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { ensureWatch, runIngestPipeline } from "@/lib/gmail/pipeline";
import { syncErrorMessage } from "@/lib/gmail/auth-error";
import { currentUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { mapWithConcurrency } from "@/lib/concurrency";

// Two callers: the Settings button (a signed-in user) and the hourly Vercel
// cron (no session, so it authenticates with CRON_SECRET instead).

// The pipeline makes dozens of model calls per account and several Gmail
// searches, so the default function timeout kills it partway and leaves the run
// half done. Vercel caps this by plan; it is the ceiling, not a target.
export const maxDuration = 300;

/// The accounts a scheduled run should sync: every account that asked for it,
/// not the first one found. With one user those are the same thing, which is
/// why syncing only the first went unnoticed; with two, the second user's mail
/// silently never arrives.
async function scheduledUserIds(): Promise<string[]> {
  const accounts = await prisma.gmailAccount.findMany({
    where: { autoSync: true },
    select: { userId: true },
  });
  return accounts.map((account) => account.userId);
}

function isCron(request: Request): boolean {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return false;
  return request.headers.get("authorization") === `Bearer ${cronSecret}`;
}

async function runFor(userId: string) {
  const result = await runIngestPipeline(userId);
  // Renewing here is what keeps push alive: a Gmail watch lapses after seven
  // days and stops delivering silently.
  await ensureWatch(userId);
  return result;
}

export async function POST(request: Request) {
  if (isCron(request)) {
    const userIds = await scheduledUserIds();
    // One account's dead token must not stop the others, so each is reported
    // rather than thrown. A run that fails for everyone still answers 200 with
    // the failures listed, which is what makes them findable in the logs.
    // Bounded rather than all at once: every account's pipeline calls the LLM,
    // and a hundred accounts firing together would hit the provider's rate
    // limit and make the failures correlated.
    const settled = await mapWithConcurrency(
      userIds,
      async (userId) => {
        try {
          return { userId, ...(await runFor(userId)) };
        } catch (error) {
          return { userId, error: syncErrorMessage(error) };
        }
      },
      { limit: 2 },
    );
    const runs = settled.map((result, index) =>
      result.status === "fulfilled"
        ? result.value
        : { userId: userIds[index]!, error: syncErrorMessage(result.reason) },
    );
    revalidatePath("/", "layout");
    const failed = runs.filter((run) => "error" in run).length;
    return NextResponse.json({ accounts: runs.length, failed, runs });
  }

  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Not authorized." }, { status: 401 });

  try {
    const result = await runFor(user.id);
    revalidatePath("/", "layout");
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: syncErrorMessage(error) }, { status: 500 });
  }
}

// Vercel cron issues GETs.
export async function GET(request: Request) {
  return POST(request);
}
