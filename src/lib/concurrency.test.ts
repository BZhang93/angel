import { describe, expect, it } from "vitest";
import { countFulfilled, mapWithConcurrency } from "./concurrency";

describe("mapWithConcurrency", () => {
  it("keeps results in input order", async () => {
    const results = await mapWithConcurrency([3, 1, 2], async (value) => {
      await new Promise((resolve) => setTimeout(resolve, value * 5));
      return value * 10;
    });
    expect(results.map((r) => (r.status === "fulfilled" ? r.value : null))).toEqual([30, 10, 20]);
  });

  it("never runs more than the limit at once", async () => {
    let running = 0;
    let peak = 0;
    await mapWithConcurrency(
      Array.from({ length: 20 }, (_, index) => index),
      async () => {
        running += 1;
        peak = Math.max(peak, running);
        await new Promise((resolve) => setTimeout(resolve, 5));
        running -= 1;
      },
      { limit: 4 },
    );
    expect(peak).toBeLessThanOrEqual(4);
    expect(peak).toBeGreaterThan(1);
  });

  it("finishes the batch when one item fails", async () => {
    const results = await mapWithConcurrency([1, 2, 3], async (value) => {
      if (value === 2) throw new Error("unreadable");
      return value;
    });
    expect(countFulfilled(results)).toBe(2);
    expect(results[1]!.status).toBe("rejected");
  });

  it("is faster than running the same work in sequence", async () => {
    const started = Date.now();
    await mapWithConcurrency(
      Array.from({ length: 12 }, (_, index) => index),
      async () => new Promise((resolve) => setTimeout(resolve, 20)),
      { limit: 6 },
    );
    // Sequential would be ~240ms; six at a time should be well under half.
    expect(Date.now() - started).toBeLessThan(160);
  });

  it("handles an empty list", async () => {
    expect(await mapWithConcurrency([], async () => 1)).toEqual([]);
  });
});
