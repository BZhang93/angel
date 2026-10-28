import "dotenv/config";

// Re-files email attachments against the rule in lib/gmail/attachment-company:
// an attachment whose filename names a portfolio company other than the one
// its email was filed under is unfiled, pending review, rather than inherited.
//
// The rule now runs at ingest, so this is for documents stored before it
// existed. Read-only unless --write is passed.
//
// Usage: NODE_OPTIONS="--conditions=react-server" pnpm exec tsx scripts/refile-attachments.mts [--write]

(globalThis as unknown as { WebSocket: unknown }).WebSocket ??= class {};

const write = process.argv.includes("--write");

const { prisma } = await import("../src/lib/prisma.ts");
const { companyForAttachment } = await import("../src/lib/gmail/attachment-company.ts");

const documents = await prisma.document.findMany({
  where: { gmailAttachmentId: { not: null }, companyId: { not: null } },
  select: {
    id: true,
    userId: true,
    title: true,
    companyId: true,
    positionId: true,
    update: { select: { companyId: true, subject: true } },
  },
});

const companiesByUser = new Map<string, { companyId: string; name: string }[]>();
for (const userId of new Set(documents.map((document) => document.userId))) {
  const rows = await prisma.company.findMany({ where: { userId }, select: { id: true, name: true } });
  companiesByUser.set(
    userId,
    rows.map((row) => ({ companyId: row.id, name: row.name })),
  );
}

let unfiled = 0;
for (const document of documents) {
  // The email's company, not the document's: the document's is the inherited
  // value being checked.
  const emailCompanyId = document.update?.companyId ?? document.companyId;
  const verdict = companyForAttachment(document.title, emailCompanyId, companiesByUser.get(document.userId) ?? []);
  if (verdict === document.companyId) continue;

  unfiled += 1;
  console.log(`unfile: ${document.title}`);
  console.log(`  arrived on: ${document.update?.subject ?? "(no email)"}`);
  console.log(`  position link: ${document.positionId ?? "none"}`);

  if (!write) continue;

  // A claim is what a source says about a position. A document disowned here
  // never said anything about this position, so the claim citing it goes too,
  // rather than being left pointing at a document filed nowhere.
  const claims = await prisma.amountClaim.deleteMany({ where: { documentId: document.id } });
  if (claims.count > 0) console.log(`  claims removed: ${claims.count}`);

  await prisma.document.update({
    where: { id: document.id },
    data: { companyId: null, positionId: null },
  });
}

console.log(write ? `unfiled ${unfiled} document(s)` : `${unfiled} document(s) would be unfiled; re-run with --write`);
