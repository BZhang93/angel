import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { ensureWatch, runIngestPipeline } from "@/lib/gmail/pipeline";
import { currentUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";

// Two callers: the Settings button (a signed-in user) and the daily Vercel cron
// (no session, so it authenticates with CRON_SECRET instead).
async function resolveUserId(request: Request): Promise<string | null> {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  if (cronSecret && authHeader === `Bearer ${cronSecret}`) {
    // The scheduled run only touches accounts that asked for it.
    const account = await prisma.gmailAccount.findFirst({
      where: { autoSync: true },
      select: { userId: true },
    });
    return account?.userId ?? null;
  }
  const user = await currentUser();
  return user?.id ?? null;
}

export async function POST(request: Request) {
  const userId = await resolveUserId(request);
  if (!userId) return NextResponse.json({ error: "Not authorized." }, { status: 401 });

  try {
    const result = await runIngestPipeline(userId);
    // Renewing here is what keeps push alive: a Gmail watch lapses after seven
    // days and stops delivering silently.
    await ensureWatch(userId);
    revalidatePath("/", "layout");
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Sync failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// Vercel cron issues GETs.
export async function GET(request: Request) {
  return POST(request);
}
