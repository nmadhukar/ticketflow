/**
 * Runs `fn` over `items` with at most `limit` calls in flight at once, and resolves
 * when all have settled. Like Promise.allSettled, one rejection does not stop the others,
 * and results come back in input order. In-house on purpose: no new dependency.
 */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      try {
        results[i] = { status: "fulfilled", value: await fn(items[i], i) };
      } catch (reason) {
        results[i] = { status: "rejected", reason };
      }
    }
  };
  const workers = Math.max(1, Math.min(Math.floor(limit) || 1, items.length));
  await Promise.all(Array.from({ length: workers }, worker));
  return results;
}
