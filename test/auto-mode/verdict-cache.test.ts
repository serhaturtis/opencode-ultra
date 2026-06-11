import { describe, it, expect } from "vitest"
import { TtlVerdictCache } from "../../src/auto-mode/verdict-cache"

describe("TtlVerdictCache", () => {
  it("reuses a verdict for an identical action within the TTL", () => {
    const cache = new TtlVerdictCache(1000, () => 0)
    cache.record("bash", "git push origin dev", "c1", { verdict: "ALLOW", reason: "ok" })
    expect(cache.lookup("bash", "git push origin dev")).toEqual({ verdict: "ALLOW", reason: "ok" })
    expect(cache.lookup("bash", "other")).toBeUndefined()
  })

  it("expires an action verdict after the TTL", () => {
    let t = 0
    const cache = new TtlVerdictCache(1000, () => t)
    cache.record("bash", "cmd", "c1", { verdict: "DENY", reason: "no" })
    t = 999
    expect(cache.lookup("bash", "cmd")).toBeDefined()
    t = 1000
    expect(cache.lookup("bash", "cmd")).toBeUndefined()
  })

  it("consumeByCall returns then removes the verdict", () => {
    const cache = new TtlVerdictCache(1000, () => 0)
    cache.record("bash", "cmd", "call-1", { verdict: "ALLOW", reason: "" })
    expect(cache.consumeByCall("call-1")).toEqual({ verdict: "ALLOW", reason: "" })
    expect(cache.consumeByCall("call-1")).toBeUndefined()
  })

  it("does not collide distinct (tool, params) pairs", () => {
    const cache = new TtlVerdictCache(1000, () => 0)
    cache.record("bash", "a b", "c1", { verdict: "ALLOW", reason: "" })
    cache.record("bash a", "b", "c2", { verdict: "DENY", reason: "" })
    expect(cache.lookup("bash", "a b")?.verdict).toBe("ALLOW")
    expect(cache.lookup("bash a", "b")?.verdict).toBe("DENY")
  })

  it("clear empties both indices", () => {
    const cache = new TtlVerdictCache(1000, () => 0)
    cache.record("bash", "cmd", "c1", { verdict: "ALLOW", reason: "" })
    cache.clear()
    expect(cache.lookup("bash", "cmd")).toBeUndefined()
    expect(cache.consumeByCall("c1")).toBeUndefined()
  })

  it("bounds memory by evicting the oldest entries", () => {
    const cache = new TtlVerdictCache(100_000, () => 0, 3)
    for (let i = 0; i < 5; i++) cache.record("bash", `cmd${i}`, `c${i}`, { verdict: "ALLOW", reason: "" })
    expect(cache.lookup("bash", "cmd0")).toBeUndefined() // evicted
    expect(cache.lookup("bash", "cmd4")).toBeDefined()
  })
})
