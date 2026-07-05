import { describe, it, expect } from "vitest"
import { runBounded, withTimeout } from "../../src/ultracode/pool"

describe("runBounded", () => {
  it("runs every item and preserves order", async () => {
    const out = await runBounded([1, 2, 3, 4, 5], 2, async (x) => x * 2)
    expect(out).toEqual([2, 4, 6, 8, 10])
  })

  it("bounds concurrency", async () => {
    let running = 0
    let max = 0
    await runBounded([1, 2, 3, 4, 5], 2, async () => {
      running++; max = Math.max(max, running)
      await new Promise((r) => setTimeout(r, 10))
      running--
    })
    expect(max).toBeLessThanOrEqual(2)
  })

  it("stops early when shouldStop becomes true", async () => {
    let done = 0
    const out = await runBounded([1, 2, 3, 4], 1, async (x) => { done++; return x }, { shouldStop: () => done >= 2 })
    expect(out.filter((x) => x !== undefined).length).toBeLessThan(4)
  })

  it("honors isPaused mid-run (no new items while paused) and resumes", async () => {
    let paused = true
    let started = 0
    const run = runBounded([1, 2, 3], 1, async (x) => { started++; return x }, { isPaused: () => paused })
    // Let the lane reach the pause wait; no item should start yet.
    await new Promise((r) => setTimeout(r, 40))
    expect(started).toBe(0)
    paused = false
    const out = await run
    expect(out).toEqual([1, 2, 3])
  })

  it("treats hasTimedOut like stop (drops remaining items)", async () => {
    let done = 0
    const out = await runBounded([1, 2, 3, 4], 1, async (x) => { done++; return x }, { hasTimedOut: () => done >= 1 })
    expect(out.filter((x) => x !== undefined).length).toBeLessThan(4)
  })
})

describe("withTimeout", () => {
  it("resolves a fast promise", async () => {
    expect(await withTimeout(Promise.resolve(7), 50, "x")).toBe(7)
  })
  it("rejects a slow promise", async () => {
    await expect(withTimeout(new Promise((r) => setTimeout(r, 1000)), 20, "agent")).rejects.toThrow(/timed out/)
  })
})
