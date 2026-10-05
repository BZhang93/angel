import "dotenv/config";

// Re-reads every update whose body was lost to the forward bug. No LLM: this is
// a Gmail re-fetch and a re-parse. Extraction is left for the normal pass, and
// each repaired row has extractedAt cleared so that pass will pick it up.
//
// Usage: NODE_OPTIONS="--conditions=react-server" pnpm exec tsx scripts/reparse-truncated.mts

const { prisma } = await import("/Users/bryanz/github/angel/src/lib/prisma.ts");
const { reparseTruncated } = await import("/Users/bryanz/github/angel/src/lib/gmail/reparse.ts");

const account = await prisma.gmailAccount.findFirst({ select: { userId: true, emailAddress: true } });
if (!account) throw new Error("No Gmail account connected.");

console.log(`re-reading for ${account.emailAddress}`);
const result = await reparseTruncated(account.userId);
console.log(result);

const remaining = await prisma.update.groupBy({
  by: ["ingestIssue"],
  _count: true,
});
console.log(remaining);
