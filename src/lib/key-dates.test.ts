import { describe, expect, it } from "vitest";
import { shapeKeyDates, type DatedItem } from "./key-dates";

function item(daysAway: number, companyId: string, label = "Something"): DatedItem {
  return {
    kind: "ACTION",
    date: new Date(Date.now() + daysAway * 24 * 60 * 60 * 1000),
    daysAway,
    companyId,
    companyName: companyId,
    label,
  };
}

describe("shapeKeyDates", () => {
  it("puts the soonest upcoming date first", () => {
    const shaped = shapeKeyDates([item(90, "a"), item(3, "b"), item(30, "c")]);
    expect(shaped.upcoming.map((entry) => entry.companyId)).toEqual(["b", "c", "a"]);
  });

  it("orders overdue by the freshest miss, not the oldest", () => {
    // A wire deadline missed yesterday is still worth chasing; one missed three
    // weeks ago is mostly a record. The actionable one goes on top.
    const shaped = shapeKeyDates([item(-20, "old"), item(-1, "fresh")]);
    expect(shaped.overdue.map((entry) => entry.companyId)).toEqual(["fresh", "old"]);
  });

  it("drops long-past items from the card and counts them", () => {
    // The real case: a reminder to attend a Q&A 171 days ago, still advertised
    // as something due in the next six months.
    const shaped = shapeKeyDates([item(-171, "marr"), item(-5, "live")]);
    expect(shaped.stale).toHaveLength(1);
    expect(shaped.overdue.map((entry) => entry.companyId)).toEqual(["live"]);
    expect(shaped.upcoming).toHaveLength(0);
  });

  it("stops one company owning the whole card", () => {
    // Six near-identical asks from one deal is what extraction actually
    // produced, and they crowded out every other company.
    const crowd = [1, 2, 3, 4, 5, 6].map((day) => item(day, "marr", `Ask ${day}`));
    const shaped = shapeKeyDates([...crowd, item(7, "bravi")]);
    expect(shaped.upcoming.filter((entry) => entry.companyId === "marr")).toHaveLength(2);
    expect(shaped.upcoming.map((entry) => entry.companyId)).toContain("bravi");
    expect(shaped.hidden).toBe(4);
  });

  it("counts rows trimmed by the limit as hidden", () => {
    const many = [1, 2, 3, 4, 5, 6, 7, 8].map((day) => item(day, `c${day}`));
    const shaped = shapeKeyDates(many, { limit: 5 });
    expect(shaped.upcoming).toHaveLength(5);
    expect(shaped.hidden).toBe(3);
  });

  it("keeps a date due today as upcoming, not overdue", () => {
    const shaped = shapeKeyDates([item(0, "today")]);
    expect(shaped.upcoming).toHaveLength(1);
    expect(shaped.overdue).toHaveLength(0);
  });

  it("returns empty lists rather than inventing filler", () => {
    const shaped = shapeKeyDates([]);
    expect(shaped).toEqual({ upcoming: [], overdue: [], stale: [], hidden: 0 });
  });
});
