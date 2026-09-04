// Running independent work in parallel, with a ceiling.
//
// Extraction is dominated by waiting on the model: each email is a call of
// several seconds that uses no local resources while it runs. Doing sixty of
// them one after another is ten minutes of mostly idle time.
//
// The ceiling matters as much as the parallelism. Unbounded fan-out would open
// sixty simultaneous requests, hit rate limits, and make failures correlated.

export const DEFAULT_CONCURRENCY = 6;

/// Maps over items with at most `limit` running at once, preserving input order
/// in the results. A failing item yields its rejection rather than aborting the
/// batch: one unreadable email must not lose the other fifty-nine.
export async function mapWithConcurrency<T, R>(
  items: T[],
  worker: (item: T, index: number) => Promise<R>,
  opts: { limit?: number } = {},
): Promise<PromiseSettledResult<R>[]> {
  const limit = Math.max(1, opts.limit ?? DEFAULT_CONCURRENCY);
  const results = new Array<PromiseSettledResult<R>>(items.length);
  let next = 0;

  async function run(): Promise<void> {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      try {
        results[index] = { status: "fulfilled", value: await worker(items[index]!, index) };
      } catch (reason) {
        results[index] = { status: "rejected", reason };
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
}

export function countFulfilled(results: PromiseSettledResult<unknown>[]): number {
  return results.filter((result) => result.status === "fulfilled").length;
}
