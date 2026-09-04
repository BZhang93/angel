import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client.ts";
import { PrismaPg } from "@prisma/adapter-pg";
import { createClient } from "@supabase/supabase-js";

// Clears everything the app derived, and keeps everything it cannot recreate.
//
// Derived data came from scans that sampled six emails per sender and matched
// on domains that were not websites, so it contains duplicate positions and
// gross bank figures recorded as investments. Re-scanning on top of it would
// leave those in place.
//
// Kept: the stored emails, as a cache of raw source. They are reset to unread
// and unfiled so the next scan re-reads them properly, which is far faster than
// re-fetching 196 messages from Gmail and costs no quota.
//
// Everything else goes, documents and their stored files included.
//
// Usage: pnpm exec tsx scripts/reset-derived.mts --confirm

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DIRECT_URL }),
});

async function main() {
  if (!process.argv.includes("--confirm")) {
    console.log("Dry run. Re-run with --confirm to apply.\n");
  }
  const apply = process.argv.includes("--confirm");

  const before = {
    companies: await prisma.company.count(),
    positions: await prisma.position.count(),
    transactions: await prisma.transaction.count(),
    candidates: await prisma.importCandidate.count(),
    payments: await prisma.payment.count(),
    claims: await prisma.amountClaim.count(),
    metrics: await prisma.updateMetric.count(),
    signals: await prisma.signal.count(),
    actionItems: await prisma.actionItem.count(),
    updates: await prisma.update.count(),
    documents: await prisma.document.count(),
    documentsWithFiles: await prisma.document.count({ where: { storagePath: { not: null } } }),
  };
  console.table(before);

  if (!apply) {
    console.log("\nWould delete: companies, positions, transactions, valuations, contacts,");
    console.log("proposals, payments, claims, metrics, signals, action items,");
    console.log("and every document with its stored file.");
    console.log("Would keep: the stored emails and the Gmail and DocuSign connections.");
    console.log("Would reset: every email to unread and unfiled.");
    return;
  }

  // Stored files go through the Storage API: Supabase refuses direct SQL
  // deletion of storage tables, and rightly so. That needs a service-role key,
  // since a script has no user session to borrow.
  const paths = (
    await prisma.document.findMany({
      where: { storagePath: { not: null } },
      select: { storagePath: true },
    })
  ).map((row) => row.storagePath!);

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;

  if (paths.length === 0) {
    console.log("no stored files to remove");
  } else if (serviceKey && supabaseUrl) {
    const bucket = process.env.SUPABASE_ATTACHMENTS_BUCKET ?? "email files";
    const storage = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    }).storage;
    const { error } = await storage.from(bucket).remove(paths);
    console.log(error ? `file removal failed: ${error.message}` : `removed ${paths.length} file(s)`);
  } else {
    console.log(
      `SUPABASE_SERVICE_ROLE_KEY is not set, so ${paths.length} file(s) stay in the bucket.\n` +
        "  The records go regardless; delete the bucket contents in the Supabase dashboard,\n" +
        "  or set the key and re-run to have them removed properly.",
    );
  }

  await prisma.document.deleteMany({});

  await prisma.amountClaim.deleteMany({});
  await prisma.payment.deleteMany({});
  await prisma.updateMetric.deleteMany({});
  await prisma.signal.deleteMany({});
  await prisma.actionItem.deleteMany({});
  await prisma.importCandidate.deleteMany({});
  // Cascades to positions, transactions, valuations and contacts.
  await prisma.company.deleteMany({});

  await prisma.update.updateMany({
    data: {
      companyId: null,
      reviewState: "PENDING",
      matchConfidence: null,
      extractedAt: null,
      importScannedAt: null,
      summary: null,
    },
  });

  const after = {
    companies: await prisma.company.count(),
    positions: await prisma.position.count(),
    candidates: await prisma.importCandidate.count(),
    payments: await prisma.payment.count(),
    updatesKept: await prisma.update.count(),
    documentsRemaining: await prisma.document.count(),
  };
  console.log("\nDone.");
  console.table(after);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
