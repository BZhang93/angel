import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

// Idempotent demo seed. Real portfolio data is entered through the UI; this
// exists so a fresh database has something to look at, and so the portfolio
// maths can be eyeballed end to end.
//
// Usage: SEED_USER_ID=<supabase auth user id> pnpm db:seed
//
// Seeds connect through DIRECT_URL: the transaction pooler does not support the
// prepared statements Prisma issues here.
const adapter = new PrismaPg({
  connectionString: process.env.DIRECT_URL ?? process.env.DATABASE_URL,
});
const prisma = new PrismaClient({ adapter });

const userId = process.env.SEED_USER_ID;

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

async function main() {
  if (!userId) {
    throw new Error(
      "SEED_USER_ID is required. Sign up in the app, then copy your id from Supabase Auth.",
    );
  }

  // A capped SAFE that converted, a note approaching maturity, and a dead one:
  // between them they exercise every branch of the portfolio maths.
  const acme = await prisma.company.upsert({
    where: { userId_name: { userId, name: "Acme Robotics" } },
    update: {},
    create: {
      userId,
      name: "Acme Robotics",
      website: "https://acme.example",
      sector: "Robotics",
      stage: "SEED",
      status: "ACTIVE",
      sourcedBy: "Angel group",
      contacts: { create: [{ name: "Jane Founder", email: "jane@acme.example", role: "CEO" }] },
    },
  });

  const acmeSafe = await prisma.position.create({
    data: {
      userId,
      companyId: acme.id,
      instrumentType: "SAFE",
      investmentDate: d("2021-04-15"),
      valuationCap: 8_000_000,
      discountPct: 20,
      safeIsPostMoney: true,
      hasProRata: true,
      qsbsEligible: true,
      transactions: {
        create: [{ userId, kind: "INVESTMENT", amount: 25_000, date: d("2021-04-15") }],
      },
    },
  });

  const acmeEquity = await prisma.position.create({
    data: {
      userId,
      companyId: acme.id,
      instrumentType: "PRICED_EQUITY",
      investmentDate: d("2023-09-01"),
      shareClass: "Series A Preferred",
      shareCount: 41_666,
      pricePerShare: 0.6,
      qsbsEligible: true,
    },
  });

  // The SAFE is linked to what it became, never rewritten.
  await prisma.position.update({
    where: { id: acmeSafe.id },
    data: { convertedIntoId: acmeEquity.id, convertedAt: d("2023-09-01") },
  });

  await prisma.valuation.createMany({
    data: [
      {
        userId,
        companyId: acme.id,
        date: d("2023-09-01"),
        pricePerShare: 0.6,
        postMoneyValuation: 30_000_000,
        source: "ROUND",
      },
      {
        userId,
        companyId: acme.id,
        date: d("2025-11-01"),
        pricePerShare: 1.4,
        postMoneyValuation: 70_000_000,
        source: "ROUND",
      },
    ],
  });

  const zephyr = await prisma.company.upsert({
    where: { userId_name: { userId, name: "Zephyr Health" } },
    update: {},
    create: {
      userId,
      name: "Zephyr Health",
      website: "https://zephyr.example",
      sector: "Digital health",
      stage: "PRE_SEED",
      status: "ACTIVE",
    },
  });

  await prisma.position.create({
    data: {
      userId,
      companyId: zephyr.id,
      instrumentType: "CONVERTIBLE_NOTE",
      investmentDate: d("2024-11-01"),
      valuationCap: 6_000_000,
      discountPct: 15,
      interestRatePct: 6,
      maturityDate: d("2026-11-01"),
      qsbsEligible: false,
      transactions: {
        create: [{ userId, kind: "INVESTMENT", amount: 15_000, date: d("2024-11-01") }],
      },
    },
  });

  const northwind = await prisma.company.upsert({
    where: { userId_name: { userId, name: "Northwind Labs" } },
    update: {},
    create: {
      userId,
      name: "Northwind Labs",
      sector: "Climate",
      stage: "SEED",
      status: "SHUT_DOWN",
    },
  });

  await prisma.position.create({
    data: {
      userId,
      companyId: northwind.id,
      instrumentType: "SAFE",
      investmentDate: d("2022-02-01"),
      valuationCap: 10_000_000,
      qsbsEligible: true,
      transactions: {
        create: [
          { userId, kind: "INVESTMENT", amount: 20_000, date: d("2022-02-01") },
          { userId, kind: "WRITE_OFF", amount: 0, date: d("2025-08-01") },
        ],
      },
    },
  });

  console.log("Seeded 3 companies for user", userId);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
