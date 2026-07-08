import { sleepUntil } from "../util.js"

/** Controls polled between items so pause/stop/timeout take effect mid-stage. */
export interface CooperativeGate {
  readonly shouldStop?: () => boolean
  readonly isPaused?: () => boolean
  readonly hasTimedOut?: () => boolean
}

export async function runBounded<T, R>(
  items: readonly T[],
  maxConcurrent: number,
  worker: (item: T, index: number) => Promise<R>,
  gate: CooperativeGate = {},
): Promise<Array<R | undefined>> {
  const results: Array<R | undefined> = new Array(items.length).fill(undefined)
  let next = 0
  const lanes = Math.max(1, Math.min(maxConcurrent, items.length))

  async function lane(): Promise<void> {
    while (true) {
      if (gate.shouldStop?.()) return
      if (gate.isPaused) await sleepUntil(() => !gate.isPaused!(), gate.shouldStop)
      if (gate.shouldStop?.() || gate.hasTimedOut?.()) return
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
