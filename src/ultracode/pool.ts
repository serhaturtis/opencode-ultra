/**
 * Bounded-concurrency primitives, shared by every stage kind.
 *
 * `runBounded` runs a worker over items with at most `maxConcurrent` in flight,
 * stopping early when `shouldStop` returns true (unstarted items resolve to
 * undefined — callers filter). `withTimeout` bounds a single agent turn.
 */
export async function runBounded<T, R>(
  items: readonly T[],
  maxConcurrent: number,
  worker: (item: T, index: number) => Promise<R>,
  shouldStop?: () => boolean,
): Promise<Array<R | undefined>> {
  const results: Array<R | undefined> = new Array(items.length).fill(undefined)
  let next = 0
  const lanes = Math.max(1, Math.min(maxConcurrent, items.length))

  async function lane(): Promise<void> {
    while (true) {
      if (shouldStop?.()) return
      const index = next++
      if (index >= items.length) return
      results[index] = await worker(items[index]!, index)
    }
  }

  await Promise.all(Array.from({ length: lanes }, lane))
  return results
}

export async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${Math.round(ms / 1000)}s`)), ms)
  })
  try {
    return await Promise.race([promise, timeout])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}
