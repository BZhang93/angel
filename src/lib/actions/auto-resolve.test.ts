import { describe, expect, it } from "vitest";
import { resolveOnPayment, type OpenAction } from "./auto-resolve";

const base: OpenAction = {
  id: "a",
  kind: "PAYMENT_DUE",
  amount: 2000,
  dueDate: new Date("2026-08-11T00:00:00Z"),
  createdAt: new Date("2026-08-06T00:00:00Z"),
  threadId: "thread-wire",
};

const payment = {
  amount: 2000,
  valueDate: new Date("2026-08-11T00:00:00Z"),
  threadIds: [] as string[],
};

describe("resolveOnPayment: money", () => {
  it("closes a payment due for the amount that was transferred", () => {
    const [resolved, ...rest] = resolveOnPayment([base], payment);
    expect(rest).toEqual([]);
    expect(resolved?.rule).toBe("AMOUNT");
    expect(resolved?.note).toBe("Closed automatically: a $2,000.00 transfer confirmed on 2026-08-11.");
  });

  it("closes it when the wire bundled the fees, which is the usual shape", () => {
    // Viaka bills $2,000 committed plus $189 of legal fees as one $2,189 wire.
    expect(resolveOnPayment([base], { ...payment, amount: 2189 })).toHaveLength(1);
  });

  it("leaves it open when the transfer is far larger than the amount due", () => {
    expect(resolveOnPayment([base], { ...payment, amount: 6000 })).toEqual([]);
  });

  it("leaves it open when less was paid than was owed", () => {
    expect(resolveOnPayment([base], { ...payment, amount: 1500 })).toEqual([]);
  });

  it("closes only the earliest of several items for the same amount", () => {
    // One transfer discharges one obligation. Closing both would hide a cheque
    // that is genuinely still owed.
    const later = { ...base, id: "b", dueDate: new Date("2026-09-30T00:00:00Z") };
    const resolved = resolveOnPayment([later, base], payment);

    expect(resolved).toHaveLength(1);
    expect(resolved[0]!.id).toBe("a");
  });

  it("falls back to creation order when neither item has a due date", () => {
    const first = { ...base, id: "first", dueDate: null, createdAt: new Date("2026-01-01") };
    const second = { ...base, id: "second", dueDate: null, createdAt: new Date("2026-05-01") };

    expect(resolveOnPayment([second, first], payment)[0]!.id).toBe("first");
  });

  it("prefers a dated obligation over an undated one", () => {
    const undated = { ...base, id: "undated", dueDate: null };
    expect(resolveOnPayment([undated, base], payment)[0]!.id).toBe("a");
  });

  it("ignores an amount on a kind that is not a payment", () => {
    const follow = { ...base, kind: "FOLLOW_UP" as const };
    expect(resolveOnPayment([follow], payment)).toEqual([]);
  });

  it("ignores a payment due that never recorded an amount", () => {
    expect(resolveOnPayment([{ ...base, amount: null }], payment)).toEqual([]);
  });
});

describe("resolveOnPayment: thread", () => {
  it("closes anything raised in the same thread, whatever its kind", () => {
    const sign = { ...base, id: "sign", kind: "CONSENT", amount: null, dueDate: null };
    const resolved = resolveOnPayment([sign], { ...payment, threadIds: ["thread-wire"] });

    expect(resolved).toHaveLength(1);
    expect(resolved[0]!.rule).toBe("THREAD");
    expect(resolved[0]!.note).toBe(
      "Closed automatically: resolved in the same email thread as a confirmed transfer.",
    );
  });

  it("leaves an unrelated reminder open: different thread, no amount match", () => {
    const unrelated: OpenAction = {
      id: "intro",
      kind: "INTRO",
      amount: null,
      dueDate: null,
      createdAt: new Date("2026-08-01"),
      threadId: "thread-other",
    };

    expect(resolveOnPayment([unrelated], { ...payment, threadIds: ["thread-wire"] })).toEqual([]);
  });

  it("closes across both the bank thread and the syndicate's wire thread", () => {
    // The transfer is read from the bank's email, but the subscription
    // agreement was raised in the syndicate's. Both are settled by it.
    const fromBank = { ...base, id: "bank", kind: "FOLLOW_UP", amount: null, threadId: "bank" };
    const fromSyndicate = { ...base, id: "spv", kind: "CONSENT", amount: null, threadId: "spv" };

    const resolved = resolveOnPayment([fromBank, fromSyndicate], {
      ...payment,
      threadIds: ["bank", "spv"],
    });

    expect(resolved.map((entry) => entry.id).sort()).toEqual(["bank", "spv"]);
  });

  it("never matches on a missing thread, which would close every loose item", () => {
    const loose = { ...base, id: "loose", kind: "INTRO", amount: null, threadId: null };
    expect(resolveOnPayment([loose], { ...payment, threadIds: [] })).toEqual([]);
  });

  it("reports an item caught by both rules once, as the money match", () => {
    const resolved = resolveOnPayment([base], { ...payment, threadIds: ["thread-wire"] });

    expect(resolved).toHaveLength(1);
    expect(resolved[0]!.rule).toBe("AMOUNT");
  });
});
