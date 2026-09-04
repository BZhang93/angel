import "dotenv/config";

// One-off for mail imported before fees were read from wire instructions.
//
// Three things happen here, and only the first is ongoing: the sync pipeline
// runs the fee pass itself from now on. The other two repair claims that older
// runs never recorded, which is why positions that reconciled perfectly still
// read as needing review.
//
// Usage: NODE_OPTIONS="--conditions=react-server" pnpm exec tsx scripts/backfill-wire-fees.mts
const { recordWireInstructionFees } = await import("../src/lib/import/wire-fees.ts");
const { prisma } = await import("../src/lib/prisma.ts");

// The first run of this recorded a WIRE_INSTRUCTION total, which was dropped:
// a schedule's total goes stale the moment a fee is waived, and it says nothing
// the commitment and fee do not.
const dropped = await prisma.amountClaim.deleteMany({
  where: { source: "WIRE_INSTRUCTION", kind: "TOTAL" },
});
console.log(`dropped ${dropped.count} stale wire-instruction totals`);

// Fees the reconciler derived from a wire were booked to the ledger but never
// claimed, so the cross-check could not see them and flagged every position
// they belonged to.
const derived = await prisma.transaction.findMany({
  where: { kind: "FEE", notes: { startsWith: "From a bank transfer" } },
  include: { position: { include: { payments: true } } },
});
for (const fee of derived) {
  const payment = fee.position.payments.find((row) => row.state === "CONFIRMED");
  if (!payment?.companyId) continue;
  await prisma.amountClaim.upsert({
    where: {
      userId_positionId_source_kind: {
        userId: fee.userId,
        positionId: fee.positionId,
        source: "BANK_TRANSFER",
        kind: "FEE",
      },
    },
    create: {
      userId: fee.userId,
      companyId: payment.companyId,
      positionId: fee.positionId,
      source: "BANK_TRANSFER",
      kind: "FEE",
      amount: fee.amount,
      sourceQuote: payment.sourceQuote,
      updateId: payment.updateId,
      paymentId: payment.id,
    },
    update: { amount: fee.amount },
  });
}
console.log(`claimed ${derived.length} bank-derived fees`);

const users = await prisma.gmailAccount.findMany({ select: { userId: true, emailAddress: true } });
for (const user of users) {
  const result = await recordWireInstructionFees(user.userId);
  console.log(`${user.emailAddress}: ${JSON.stringify(result)}`);
}
await prisma.$disconnect();
