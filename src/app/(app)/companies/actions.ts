"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUserId } from "@/lib/session";
import type {
  ActionKind,
  CompanyStatus,
  HoldingEntity,
  InstrumentType,
  Stage,
  TransactionKind,
  ValuationSource,
} from "@/generated/prisma/enums";

// Server actions for manual entry. Every one of them re-reads the session and
// scopes the write to that user id: the form is never trusted for ownership.

export type ActionResult = { status: "error"; message: string } | void;

function str(form: FormData, key: string): string {
  return String(form.get(key) ?? "").trim();
}

function optionalStr(form: FormData, key: string): string | null {
  const value = str(form, key);
  return value === "" ? null : value;
}

function optionalNumber(form: FormData, key: string): number | null {
  const value = str(form, key);
  if (value === "") return null;
  const parsed = Number(value.replace(/[$,\s]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function optionalDate(form: FormData, key: string): Date | null {
  const value = str(form, key);
  if (value === "") return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

export async function createCompany(form: FormData): Promise<ActionResult> {
  const userId = await requireUserId();
  const name = str(form, "name");
  if (!name) return { status: "error", message: "Company name is required." };

  const existing = await prisma.company.findFirst({ where: { userId, name } });
  if (existing) return { status: "error", message: `${name} is already in the portfolio.` };

  const company = await prisma.company.create({
    data: {
      userId,
      name,
      website: optionalStr(form, "website"),
      sector: optionalStr(form, "sector"),
      hqCountry: optionalStr(form, "hqCountry"),
      sourcedBy: optionalStr(form, "sourcedBy"),
      notes: optionalStr(form, "notes"),
      stage: (optionalStr(form, "stage") ?? "UNKNOWN") as Stage,
      status: (optionalStr(form, "status") ?? "ACTIVE") as CompanyStatus,
    },
  });

  // The first position and its cheque are entered on the same form: a company
  // with no position is not an investment, it is a note to self.
  const amount = optionalNumber(form, "amount");
  const investmentDate = optionalDate(form, "investmentDate");
  if (amount != null && investmentDate) {
    const position = await prisma.position.create({
      data: {
        userId,
        companyId: company.id,
        instrumentType: (optionalStr(form, "instrumentType") ?? "SAFE") as InstrumentType,
        holdingEntity: (optionalStr(form, "holdingEntity") ?? "PERSONAL") as HoldingEntity,
        investmentDate,
        valuationCap: optionalNumber(form, "valuationCap"),
        discountPct: optionalNumber(form, "discountPct"),
        safeIsPostMoney: str(form, "safeIsPostMoney") === "on" ? true : null,
        hasProRata: str(form, "hasProRata") === "on",
        maturityDate: optionalDate(form, "maturityDate"),
        qsbsEligible: str(form, "qsbsEligible") === "on",
      },
    });

    await prisma.transaction.create({
      data: {
        userId,
        positionId: position.id,
        kind: "INVESTMENT",
        amount,
        date: investmentDate,
      },
    });
  }

  revalidatePath("/", "layout");
  redirect(`/companies/${company.id}`);
}

export async function addPosition(form: FormData): Promise<ActionResult> {
  const userId = await requireUserId();
  const companyId = str(form, "companyId");
  const investmentDate = optionalDate(form, "investmentDate");
  const amount = optionalNumber(form, "amount");

  if (!investmentDate) return { status: "error", message: "Investment date is required." };

  const company = await prisma.company.findFirst({ where: { id: companyId, userId } });
  if (!company) return { status: "error", message: "Company not found." };

  const position = await prisma.position.create({
    data: {
      userId,
      companyId,
      instrumentType: (optionalStr(form, "instrumentType") ?? "SAFE") as InstrumentType,
      holdingEntity: (optionalStr(form, "holdingEntity") ?? "PERSONAL") as HoldingEntity,
      investmentDate,
      valuationCap: optionalNumber(form, "valuationCap"),
      discountPct: optionalNumber(form, "discountPct"),
      interestRatePct: optionalNumber(form, "interestRatePct"),
      maturityDate: optionalDate(form, "maturityDate"),
      shareClass: optionalStr(form, "shareClass"),
      shareCount: optionalNumber(form, "shareCount"),
      pricePerShare: optionalNumber(form, "pricePerShare"),
      ownershipPct: optionalNumber(form, "ownershipPct"),
      managementFeePct: optionalNumber(form, "managementFeePct"),
      carryPct: optionalNumber(form, "carryPct"),
      hasProRata: str(form, "hasProRata") === "on",
      qsbsEligible: str(form, "qsbsEligible") === "on",
      notes: optionalStr(form, "notes"),
    },
  });

  if (amount != null) {
    await prisma.transaction.create({
      data: { userId, positionId: position.id, kind: "INVESTMENT", amount, date: investmentDate },
    });
  }

  revalidatePath(`/companies/${companyId}`);
}

export async function addTransaction(form: FormData): Promise<ActionResult> {
  const userId = await requireUserId();
  const positionId = str(form, "positionId");
  const amount = optionalNumber(form, "amount");
  const date = optionalDate(form, "date");

  if (amount == null || !date) {
    return { status: "error", message: "Amount and date are required." };
  }

  // Ownership check via the position, so a forged positionId cannot write into
  // someone else's ledger.
  const position = await prisma.position.findFirst({
    where: { id: positionId, userId },
    select: { companyId: true },
  });
  if (!position) return { status: "error", message: "Position not found." };

  await prisma.transaction.create({
    data: {
      userId,
      positionId,
      kind: (optionalStr(form, "kind") ?? "INVESTMENT") as TransactionKind,
      amount,
      date,
      notes: optionalStr(form, "notes"),
    },
  });

  revalidatePath(`/companies/${position.companyId}`);
}

export async function addValuation(form: FormData): Promise<ActionResult> {
  const userId = await requireUserId();
  const companyId = str(form, "companyId");
  const date = optionalDate(form, "date");
  if (!date) return { status: "error", message: "Valuation date is required." };

  const company = await prisma.company.findFirst({ where: { id: companyId, userId } });
  if (!company) return { status: "error", message: "Company not found." };

  await prisma.valuation.create({
    data: {
      userId,
      companyId,
      date,
      pricePerShare: optionalNumber(form, "pricePerShare"),
      postMoneyValuation: optionalNumber(form, "postMoneyValuation"),
      source: (optionalStr(form, "source") ?? "ESTIMATE") as ValuationSource,
      notes: optionalStr(form, "notes"),
    },
  });

  revalidatePath(`/companies/${companyId}`);
}

export async function addActionItem(form: FormData): Promise<ActionResult> {
  const userId = await requireUserId();
  const companyId = str(form, "companyId");
  const title = str(form, "title");
  if (!title) return { status: "error", message: "A title is required." };

  const company = await prisma.company.findFirst({ where: { id: companyId, userId } });
  if (!company) return { status: "error", message: "Company not found." };

  await prisma.actionItem.create({
    data: {
      userId,
      companyId,
      kind: (optionalStr(form, "kind") ?? "FOLLOW_UP") as ActionKind,
      title,
      detail: optionalStr(form, "detail"),
      dueDate: optionalDate(form, "dueDate"),
    },
  });

  revalidatePath("/", "layout");
}

// Bound directly to a plain <form action={...}>, so these two return void and
// throw on the impossible case rather than handing back an error object.
export async function completeActionItem(form: FormData): Promise<void> {
  const userId = await requireUserId();
  const id = str(form, "id");

  const updated = await prisma.actionItem.updateMany({
    where: { id, userId },
    data: { state: "DONE", completedAt: new Date() },
  });
  if (updated.count === 0) throw new Error("Action item not found.");

  revalidatePath("/", "layout");
}

export async function updateCompanyStatus(form: FormData): Promise<void> {
  const userId = await requireUserId();
  const id = str(form, "id");
  const status = str(form, "status") as CompanyStatus;

  const updated = await prisma.company.updateMany({ where: { id, userId }, data: { status } });
  if (updated.count === 0) throw new Error("Company not found.");

  revalidatePath("/", "layout");
}
