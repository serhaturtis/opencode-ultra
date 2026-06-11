/**
 * Workflow registry state — completeJob() must bound retained completed jobs so a
 * long-lived plugin process doesn't accumulate them without limit, and must move a
 * job from active to completed exactly once.
 */
import { describe, it, expect } from "vitest"
import { createState, completeJob } from "../../src/state"
import { compileConfig } from "../../src/config"
import type { WorkflowJob } from "../../src/contracts"

const config = compileConfig({})
const mkJob = (id: string) => ({ id, title: id, status: "completed" } as unknown as WorkflowJob)

describe("completeJob — bounded completed-jobs registry", () => {
  it("retains at most 50 completed jobs, keeping the most recent", () => {
    const state = createState(() => config)
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
    const state = createState(() => config)
    const job = mkJob("x")
    state.workflows.jobs.set(job.id, job)
    completeJob(state, job)
    completeJob(state, job) // no-op: already removed from the active set
    expect(state.workflows.jobs.has("x")).toBe(false)
    expect(state.workflows.completedJobs.filter((j) => j.id === "x")).toHaveLength(1)
  })
})
