/**
 * Workflow registry state — completeJob() must bound retained completed jobs so a
 * long-lived plugin process doesn't accumulate them without limit, and must move a
 * job from active to completed exactly once.
 */
import { describe, it, expect } from "vitest"
import { createState, completeJob } from "../../src/state"
import { compileConfig } from "../../src/config"
import { TtlVerdictCache } from "../../src/auto-mode/verdict-cache"
import type { WorkflowJob } from "../../src/contracts"

const config = compileConfig({})
const factory = (ttlMs: number) => new TtlVerdictCache(ttlMs)
const st = () => createState(() => config, undefined, factory)
const mkJob = (id: string, parentSessionId = "session"): WorkflowJob => {
  const job = { id, title: id, parentSessionId, status: "completed" } as {
    id: string; title: string; parentSessionId: string; status: WorkflowJob["status"]
  }
  return Object.assign(job as object, {
    stop() { job.status = "cancelled" },
  }) as unknown as WorkflowJob
}

describe("completeJob — bounded completed-jobs registry", () => {
  it("retains at most 50 completed jobs, keeping the most recent", () => {
    const state = st()
    for (let i = 0; i < 60; i++) {
      const job = mkJob(`j${i}`)
      state.workflows.jobs.set(job.id, job)
      completeJob(state, job)
    }
    const completed = state.workflows.completedJobs
    expect(completed.length).toBe(50)
    expect(completed[0]!.id).toBe("j10")                       // oldest 10 evicted
    expect(completed[completed.length - 1]!.id).toBe("j59")    // newest kept
  })

  it("moves a job from active to completed exactly once (idempotent)", () => {
    const state = st()
    const job = mkJob("x")
    state.workflows.jobs.set(job.id, job)
    completeJob(state, job)
    completeJob(state, job) // no-op: already removed from the active set
    expect(state.workflows.jobs.has("x")).toBe(false)
    expect(state.workflows.completedJobs.filter((j) => j.id === "x")).toHaveLength(1)
  })
})

describe("stopForSession — orphan cancellation on session.deleted", () => {
  it("cancels every in-flight job spawned by the given session and returns their ids", () => {
    const state = st()
    const a1 = mkJob("a1", "sessionA"); state.workflows.jobs.set("a1", a1)
    const a2 = mkJob("a2", "sessionA"); state.workflows.jobs.set("a2", a2)
    const b1 = mkJob("b1", "sessionB"); state.workflows.jobs.set("b1", b1)

    const stopped = state.workflows.stopForSession("sessionA")

    expect([...stopped].sort()).toEqual(["a1", "a2"])
    expect(a1.status).toBe("cancelled")
    expect(a2.status).toBe("cancelled")
    expect(b1.status).toBe("completed") // other session untouched
  })

  it("leaves jobs of other sessions running", () => {
    const state = st()
    const b1 = mkJob("b1", "sessionB"); state.workflows.jobs.set("b1", b1)
    expect(state.workflows.stopForSession("sessionA")).toEqual([])
    expect(b1.status).toBe("completed")
  })
})
