import "dotenv/config";

// One-off sweep for reminders that were never given a chance to close.
//
// Three things, and only the second is ongoing: extraction settles both ways
// from now on. The other two repair history.
//
// Usage: NODE_OPTIONS="--conditions=react-server" pnpm exec tsx scripts/backfill-settle.mts

const { prisma } = await import("/Users/bryanz/github/angel/src/lib/prisma.ts");
const { settleCompanyActions } = await import("/Users/bryanz/github/angel/src/lib/actions/settle.ts");
const { extractFromUpdate } = await import("/Users/bryanz/github/angel/src/lib/extract/update.ts");
const { applyExtraction } = await import("/Users/bryanz/github/angel/src/lib/extract/apply.ts");
const { mapWithConcurrency } = await import("/Users/bryanz/github/angel/src/lib/concurrency.ts");

// 1. The importer used to raise its wire reminder as a bare FOLLOW_UP with no
// amount and no source email, so it carried nothing either rule could match.
// It has been a PAYMENT_DUE since BRA-209; these are the ones raised before.
const legacy = await prisma.actionItem.findMany({
  where: { state: "OPEN", kind: "FOLLOW_UP", updateId: null, title: { startsWith: "Confirm the wire to" } },
  include: { company: { include: { positions: { include: { transactions: true } } } } },
});
for (const item of legacy) {
  const invested = item.company.positions
    .flatMap((p) => p.transactions)
    .filter((t) => t.kind === "INVESTMENT" || t.kind === "CAPITAL_CALL")
    .reduce((total, t) => total + Number(t.amount.toString()), 0);
  await prisma.actionItem.update({
    where: { id: item.id },
    data: { kind: "PAYMENT_DUE", amount: invested > 0 ? invested : null },
  });
  console.log(`converted to PAYMENT_DUE: ${item.company.name} (${invested || "no amount"})`);
}

// 2. Every confirmed payment against everything still open.
const companies = await prisma.company.findMany({ select: { id: true, name: true, userId: true } });
let closed = 0;
for (const c of companies) closed += await settleCompanyActions(c.userId, c.id);
console.log(`payment sweep closed ${closed}`);

// 3. A company still owing money with no payment on file can only be settled by
// a syndicate saying so, and that field did not exist when its mail was read.
const stuck = [];
for (const c of companies) {
  const owed = await prisma.actionItem.count({ where: { companyId: c.id, state: "OPEN", kind: "PAYMENT_DUE" } });
  const paid = await prisma.payment.count({ where: { companyId: c.id, state: "CONFIRMED" } });
  if (owed > 0 && paid === 0) stuck.push(c);
}
console.log(`re-reading mail for ${stuck.length} compan${stuck.length === 1 ? "y" : "ies"} with no payment on file`);

for (const c of stuck) {
  const updates = await prisma.update.findMany({
    where: { companyId: c.id, reviewState: "CONFIRMED" },
    orderBy: { receivedAt: "asc" },
  });
  const results = await mapWithConcurrency(updates, async (u) => {
    const extraction = await extractFromUpdate({
      companyName: c.name, subject: u.subject, receivedAt: u.receivedAt, text: u.rawText,
    });
    await applyExtraction(u.userId, u.id, c.id, extraction, { subject: u.subject, rawText: u.rawText });
    return extraction.fundingComplete ? u.subject : null;
  });
  const stated = results.flatMap((r) => (r.status === "fulfilled" && r.value ? [r.value] : []));
  console.log(`  ${c.name}: re-read ${updates.length}, funding stated complete in ${stated.length}`);
  for (const s of stated) console.log(`      "${String(s).slice(0, 70)}"`);
}

const remaining = await prisma.actionItem.count({ where: { state: "OPEN" } });
console.log(`\nOPEN action items remaining: ${remaining}`);
await prisma.$disconnect();
