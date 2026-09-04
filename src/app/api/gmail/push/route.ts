import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { runIngestPipeline, ensureWatch } from "@/lib/gmail/pipeline";

// Gmail push notifications, delivered by Cloud Pub/Sub.
//
// Pub/Sub posts a base64 message naming the mailbox and a history id. It says
// nothing about what changed, so the body is only a trigger: the pipeline works
// out what is new the same way the manual sync does.
//
// The endpoint is public by necessity, so it is guarded by a shared secret in
// the query string, which is what Pub/Sub push subscriptions support.
export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET;
  const provided = new URL(request.url).searchParams.get("token");
  if (!secret || provided !== secret) {
    return NextResponse.json({ error: "Not authorized." }, { status: 401 });
  }

  let emailAddress: string | null = null;
  try {
    const body = (await request.json()) as { message?: { data?: string } };
    if (body.message?.data) {
      const decoded = JSON.parse(Buffer.from(body.message.data, "base64").toString("utf8")) as {
        emailAddress?: string;
      };
      emailAddress = decoded.emailAddress ?? null;
    }
  } catch {
    // A malformed body is still worth acknowledging: Pub/Sub retries anything
    // it does not get a 2xx for, and retrying a bad message forever helps
    // nobody.
    return NextResponse.json({ ok: true, ignored: "unparseable" });
  }

  const account = emailAddress
    ? await prisma.gmailAccount.findFirst({ where: { emailAddress, autoSync: true } })
    : null;
  if (!account) return NextResponse.json({ ok: true, ignored: "no matching account" });

  try {
    const result = await runIngestPipeline(account.userId);
    await ensureWatch(account.userId);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    // Returning 200 stops Pub/Sub retrying a failure that will not fix itself;
    // the next notification or the scheduled poll picks the work up.
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : "Pipeline failed.",
    });
  }
}
