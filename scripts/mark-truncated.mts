import "dotenv/config";

// Marks the updates that were stored before the forward fix, so the damage is
// visible in the UI without waiting for a re-sync.
//
// These rows cannot be detected the way new ones are: the pre-strip length was
// never recorded, so there is nothing to compare against. They are found by
// shape instead, which is unambiguous because the stripper always cut at the
// same place and left the forward delimiter and nothing else.
//
// Usage: NODE_OPTIONS="--conditions=react-server" pnpm exec tsx scripts/mark-truncated.mts

const { prisma } = await import("/Users/bryanz/github/angel/src/lib/prisma.ts");

// Deliberately narrow: a short body that is only a forward preamble. A terse
// human reply has no delimiter in it and is left alone.
const STUB_MAX_CHARS = 200;

const candidates = await prisma.update.findMany({
  where: { rawText: { contains: "Forwarded message" } },
  select: { id: true, subject: true, rawText: true, companyId: true, ingestIssue: true },
});

const stubs = candidates.filter((update) => update.rawText.trim().length <= STUB_MAX_CHARS);

console.log(`${candidates.length} forwarded, ${stubs.length} of them stored as a stub`);

for (const stub of stubs) {
  console.log(`  ${stub.rawText.trim().length.toString().padStart(4)} chars  ${stub.subject}`);
}

if (stubs.length === 0) process.exit(0);

const marked = await prisma.update.updateMany({
  where: { id: { in: stubs.map((s) => s.id) }, ingestIssue: null },
  data: { ingestIssue: "TRUNCATED_BODY" },
});

console.log(`\nmarked ${marked.count} as TRUNCATED_BODY`);

// Step 2: the same repair for extractions that already finished empty-handed.
// From now on `applyExtraction` records this itself; these ran before it did.
const extracted = await prisma.update.findMany({
  where: { extractedAt: { not: null }, ingestIssue: null },
  select: {
    id: true,
    _count: { select: { signals: true, metrics: true, actionItems: true, payments: true } },
  },
});

const empty = extracted.filter(
  (update) =>
    update._count.signals === 0 &&
    update._count.metrics === 0 &&
    update._count.actionItems === 0 &&
    update._count.payments === 0,
);

const emptied = await prisma.update.updateMany({
  where: { id: { in: empty.map((u) => u.id) } },
  data: { ingestIssue: "NOTHING_EXTRACTED" },
});

console.log(`marked ${emptied.count} as NOTHING_EXTRACTED`);
