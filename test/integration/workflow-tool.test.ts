/**
 * Workflow tool contract — single-path background execution and id consistency.
 *
 * Regression coverage for live bugs:
 *  - validate persisted stale pending jobs and printed an unusable id;
 *  - the manager displayed a truncated id that execute/lookup could not resolve;
 *  - execute required a prior validate + id juggling instead of taking a definition;
 *  - the model busy-polled status instead of waiting for the result.
 * The fixed contract: validate is a pure preview (no state); execute takes a
 * definition and starts in the background (non-blocking), returning a no-poll
 * contract; the result is pushed back on completion; the id resolves everywhere;
 * and a running workflow's manager output is terse so polling has no payoff.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest"
import * as os from "node:os"
import * as fs from "node:fs"
import * as path from "node:path"
import { createWorkflowTool } from "../../src/ultracode/workflow-tool"
import { createWorkflowManagerTool } from "../../src/ultracode/workflow-manager"
import { WorktreeManager } from "../../src/ultracode/worktree"
import { createState } from "../../src/state"
import { compileConfig } from "../../src/config"
import { TtlVerdictCache } from "../../src/auto-mode/verdict-cache"
import { createMockSdk } from "../helpers/mock-sdk"
import { NoopMetrics } from "../../src/metrics"
import type { CompiledConfig, UltraState } from "../../src/contracts"

const ctx = { sessionID: "parent" } as never

const DEF = JSON.stringify({
  title: "demo",
  stages: [{ kind: "fanout", name: "find", agents: [{ name: "scan", task: "list files", agent: "explore" }] }],
})
const out = (r: unknown) => r as { title: string; output: string; metadata: Record<string, unknown> }

describe("workflow tool — validate/execute contract", () => {
  let state: UltraState
  let config: CompiledConfig
  let wf: ReturnType<typeof createWorkflowTool>
  let mgr: ReturnType<typeof createWorkflowManagerTool>
  let projectDir: string
  let worktrees: WorktreeManager

  beforeEach(() => {
    config = compileConfig({ ultracode: { enabled: true } })
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "wf-tool-"))
    worktrees = new WorktreeManager(projectDir)
    state = createState(() => config, worktrees, (ttlMs) => new TtlVerdictCache(ttlMs))
    wf = createWorkflowTool(createMockSdk().sdk, state, () => config, projectDir, worktrees, NoopMetrics)
    mgr = createWorkflowManagerTool(state)
  })
  afterEach(() => { fs.rmSync(projectDir, { recursive: true, force: true }) })

  it("execute starts in one call (non-blocking) and returns a real id with a no-poll contract", async () => {
    const r = out(await wf.execute({ action: "execute", definition: DEF }, ctx))
    const id = r.metadata.workflowId as string
    expect(id).toBeTruthy()
    expect(id).not.toContain("...")
    expect(r.title).toMatch(/started/i)
    expect(r.output).toMatch(/background/i)
    expect(r.output).toMatch(/not.*poll/i) // the contract tells the model to stop, not poll
  })

  it("the returned id is exactly what the manager lists AND can resolve (no truncation drift)", async () => {
    const id = out(await wf.execute({ action: "execute", definition: DEF }, ctx)).metadata.workflowId as string
    const list = out(await mgr.execute({ action: "list" }, ctx))
    expect(list.output).toContain(id) // displayed id == lookup key
    // The same id resolves — this is what threw WorkflowNotFoundError in production.
    const view = out(await mgr.execute({ action: "output", workflowId: id }, ctx))
    expect(view.title).toBeTruthy()
  })

  it("validate is a pure preview: reports VALID + cost and starts no job", async () => {
    const v = out(await wf.execute({ action: "validate", definition: DEF }, ctx))
    expect(v.title).toMatch(/VALID/)
    expect(v.output).not.toContain("'...'")
    expect(v.output).toMatch(/Estimated:/)
    // No side effects — nothing registered.
    const list = out(await mgr.execute({ action: "list" }, ctx))
    expect(list.output).toMatch(/No workflows found/)
  })

  it("execute without a definition fails clearly", async () => {
    await expect(wf.execute({ action: "execute" }, ctx)).rejects.toThrow(/definition/i)
  })

  it("resume with an unknown workflowId is a not-found error", async () => {
    await expect(wf.execute({ action: "resume", workflowId: "deadbeef" }, ctx)).rejects.toThrow(/deadbeef/i)
  })

  it("on completion, pushes the result into the parent session (noReply:false) so the model needn't poll", async () => {
    let resolveWoke!: () => void
    const woke = new Promise<void>((r) => { resolveWoke = r })
    let wakeText = ""
    const base = createMockSdk()
    const sdk = {
      ...base.sdk,
      promptSession: async (sid: string, opts: { noReply?: boolean; parts: Array<{ text: string }> }) => {
        // The completion notify is the only noReply:false prompt to the parent.
        if (sid === "parent" && opts.noReply === false) { wakeText = opts.parts[0]!.text; resolveWoke() }
        return { text: "mock response text", cost: 0, tokens: 0 }
      },
    }
    const localWf = createWorkflowTool(sdk as never, state, () => config, projectDir, worktrees, NoopMetrics)
    out(await localWf.execute({ action: "execute", definition: DEF }, ctx)) // returns immediately
    await woke // resolves only when the background run pushes its result
    expect(wakeText).toMatch(/Workflow .* (completed|failed|was stopped)/)
  })

  it("a running workflow's manager output is terse and tells the model not to poll", async () => {
    // Pause the run by stalling the subagent prompt so the job stays 'running'.
    let release!: () => void
    const gate = new Promise<void>((r) => { release = r })
    const base = createMockSdk()
    const sdk = {
      ...base.sdk,
      promptSession: async (_sid: string) => { await gate; return { text: "mock response text", cost: 0, tokens: 0 } },
    }
    const localWf = createWorkflowTool(sdk as never, state, () => config, projectDir, worktrees, NoopMetrics)
    const id = out(await localWf.execute({ action: "execute", definition: DEF }, ctx)).metadata.workflowId as string
    const view = out(await mgr.execute({ action: "output", workflowId: id }, ctx))
    expect(view.output).toMatch(/running/i)
    expect(view.output).toMatch(/not.*poll/i)
    release() // let the background run finish + clean up
  })

  it("an invalid definition returns INVALID and registers no runnable job", async () => {
    const bad = JSON.stringify({
      stages: [{ kind: "fanout", name: "a", agents: [{ name: "x", task: "t", agent: "wizard" }] }],
    })
    const r = out(await wf.execute({ action: "execute", definition: bad }, ctx))
    expect(r.output).toMatch(/INVALID/)
    const list = out(await mgr.execute({ action: "list" }, ctx))
    expect(list.output).toMatch(/No workflows found/)
  })
})
