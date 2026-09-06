import { describe, expect, it } from "vitest";
import { groupPendingUpdates } from "./review-queue";

const names = new Map([
  ["asendia", "Asendia"],
  ["bravi", "Bravi"],
]);

function item(companyId: string | null, day: string) {
  return { id: `${companyId ?? "none"}-${day}`, companyId, receivedAt: new Date(`2026-0${day}`) };
}

describe("groupPendingUpdates", () => {
  it("puts every update for one company together", () => {
    const groups = groupPendingUpdates(
      [item("bravi", "3-01"), item("asendia", "5-01"), item("bravi", "4-01")],
      names,
    );

    expect(groups).toHaveLength(2);
    expect(groups[0]!.companyName).toBe("Bravi");
    expect(groups[0]!.items).toHaveLength(2);
  });

  it("orders groups by their oldest waiting item, and items oldest first", () => {
    const groups = groupPendingUpdates(
      [item("asendia", "2-01"), item("bravi", "1-01"), item("bravi", "9-01")],
      names,
    );

    expect(groups.map((group) => group.companyName)).toEqual(["Bravi", "Asendia"]);
    expect(groups[0]!.items.map((entry) => entry.id)).toEqual(["bravi-1-01", "bravi-9-01"]);
  });

  it("keeps unassigned last, however old it is", () => {
    const groups = groupPendingUpdates([item(null, "1-01"), item("asendia", "8-01")], names);

    expect(groups.map((group) => group.companyName)).toEqual(["Asendia", null]);
    expect(groups[1]!.companyId).toBeNull();
  });

  it("treats a match against a deleted company as unassigned, rather than losing it", () => {
    const groups = groupPendingUpdates([item("gone", "1-01")], names);

    expect(groups).toHaveLength(1);
    expect(groups[0]!.companyId).toBeNull();
    expect(groups[0]!.items).toHaveLength(1);
  });

  it("returns nothing for an empty queue, and no empty unassigned group", () => {
    expect(groupPendingUpdates([], names)).toEqual([]);
  });
});
