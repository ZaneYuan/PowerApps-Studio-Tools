/** Runs `worker` over `items` with at most `concurrency` in flight at once. Each of the
 *  `concurrency` runners pulls the next unclaimed index itself (instead of splitting `items` into
 *  fixed per-runner chunks up front) so a few slow rows don't leave other runners idle while one
 *  runner still has a long queue. `shouldStop` is checked before claiming each new item — so the
 *  SQL4CDS "停止" button still only ever prevents *starting* new writes, never aborts one already
 *  in flight (no AbortController is wired through the native bridge — see Sql4Cds.tsx's
 *  stopRequestedRef doc comment, same rule as the previous sequential loops). */
export async function runConcurrent<T>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<void>,
  shouldStop: () => boolean,
): Promise<void> {
  let nextIndex = 0;
  async function runner(): Promise<void> {
    while (nextIndex < items.length) {
      if (shouldStop()) return;
      const index = nextIndex++;
      await worker(items[index], index);
    }
  }
  const runnerCount = Math.max(1, Math.min(concurrency, items.length));
  await Promise.all(Array.from({ length: runnerCount }, runner));
}
