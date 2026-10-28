import "dotenv/config";

// Collects attachments for mail that was stored without them, which is every
// message the import scan read: it skips attachments for speed, and the sync
// never revisits a stored message id.
//
// Usage: NODE_OPTIONS="--conditions=react-server" pnpm exec tsx scripts/backfill-attachments.mts
//
// Gmail reads and Supabase uploads only, no model calls, so this costs nothing
// but time. Run it repeatedly until it reports complete.

// Node 20 has no global WebSocket, and supabase-js builds a realtime client on
// createClient whether or not anything subscribes, so storage is unreachable
// without one. A stub satisfies the constructor; the real fix is Node 22,
// which this project needs anyway. Harmless under Node 22, where the global
// already exists and ??= leaves it alone.
(globalThis as unknown as { WebSocket: unknown }).WebSocket ??= class {};

const { prisma } = await import("../src/lib/prisma.ts");
const { backfillAttachments } = await import("../src/lib/gmail/backfill-attachments.ts");

const account = await prisma.gmailAccount.findFirst({
  select: { userId: true, emailAddress: true },
});
if (!account) throw new Error("No Gmail account connected.");

console.log(`collecting attachments for ${account.emailAddress}`);
for (let pass = 1; ; pass++) {
  const result = await backfillAttachments(account.userId);
  console.log(`pass ${pass}:`, result);
  if (result.complete) break;
}

const remaining = await prisma.update.count({ where: { attachmentsCheckedAt: null } });
const documents = await prisma.document.count({ where: { gmailMessageId: { not: null } } });
const withBytes = await prisma.document.count({
  where: { gmailMessageId: { not: null }, storagePath: { not: null } },
});
console.log(`unchecked left: ${remaining}; documents from attachments: ${documents}, ${withBytes} with bytes`);
