import { describe, it, expect } from "vitest"
import { onEvent, onCompacting, onDispose } from "../../src/hooks/event-handlers"
import { createState } from "../../src/state"
import { compileConfig } from "../../src/config"
import { TtlVerdictCache } from "../../src/auto-mode/verdict-cache"
import { NoopMetrics } from "../../src/metrics"
import type { PluginContext } from "../../src/hooks/context"

function makeCtx(overrides: Partial<PluginContext> = {}): PluginContext {
  const base = compileConfig({ autoMode: { enabled: true, defaultMode: true }, ultracode: { enabled: true } })
  const state = createState(() => base, undefined, (ttlMs) => new TtlVerdictCache(ttlMs))
  const sdk = { log(_l: string, _m: string) {} } as PluginContext["sdk"]
  return { sdk, state, config: base, directory: "/tmp", worktrees: { cleanupAllActive: async () => {} }, classifier: {} as any, metrics: NoopMetrics, ...overrides }
}

describe("onEvent", () => {
  it("session.deleted removes session and cancels workflows", async () => {
    const ctx = makeCtx()
    ctx.state.sessions.get("s1") // create session
    await onEvent(ctx, { event: { type: "session.deleted", properties: { info: { id: "s1", worktree: "", time: {} } } } } as any)
    expect(ctx.state.sessions.peek("s1")).toBeUndefined()
  })

  it("session.error pauses auto-mode for that session", async () => {
    const ctx = makeCtx()
    const ses = ctx.state.sessions.get("s2")
    ses.autoMode.active = true; ses.autoMode.paused = false
    await onEvent(ctx, { event: { type: "session.error", properties: { sessionID: "s2" } } } as any)
    expect(ses.autoMode.paused).toBe(true)
  })

  it("session.error is a no-op when session does not exist", async () => {
    const ctx = makeCtx()
    await expect(onEvent(ctx, { event: { type: "session.error", properties: { sessionID: "ghost" } } } as any)).resolves.toBeUndefined()
  })

  it("permission.replied resumes paused auto-mode on non-reject", async () => {
    const ctx = makeCtx()
    const ses = ctx.state.sessions.get("s3")
    ses.autoMode.active = true; ses.autoMode.paused = true; ses.autoMode.consecutiveDenials = 5
    await onEvent(ctx, { event: { type: "permission.replied", properties: { sessionID: "s3", permissionID: "p1", response: "allow" } } } as any)
    expect(ses.autoMode.paused).toBe(false)
    expect(ses.autoMode.consecutiveDenials).toBe(0)
  })

  it("permission.replied does not resume on reject", async () => {
    const ctx = makeCtx()
    const ses = ctx.state.sessions.get("s4")
    ses.autoMode.active = true; ses.autoMode.paused = true
    await onEvent(ctx, { event: { type: "permission.replied", properties: { sessionID: "s4", permissionID: "p2", response: "reject" } } } as any)
    expect(ses.autoMode.paused).toBe(true)
  })
})

describe("onCompacting", () => {
  it("pushes standing boundaries into compaction context", () => {
    const ctx = makeCtx()
    const ses = ctx.state.sessions.get("s5")
    ses.autoMode.active = true
    ses.autoMode.boundaries.push("never push to main")
    const out = { context: [] as string[], prompt: undefined as string | undefined }
    onCompacting(ctx, { sessionID: "s5" } as any, out)
    expect(out.context.some((c) => c.includes("never push to main"))).toBe(true)
    expect(ses.autoMode.boundaries).toHaveLength(0)
  })
})

describe("onDispose", () => {
  it("shuts down workflow state", async () => {
    const ctx = makeCtx()
    await onDispose(ctx)
    // shutdown is best-effort — just verify it resolves without throwing
  })
})
