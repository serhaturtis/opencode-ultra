import { describe, it, expect } from "vitest"
import { WorktreeManager, type GitRunner, type GitResult } from "../../src/ultracode/worktree"
import type { AgentResult } from "../../src/contracts"

const ok = (name: string): AgentResult => ({ name, status: "completed", text: "", cost: 0, tokens: 0 })

/** Build a fake git that records commands and answers via a script. */
function fakeGit(script: (args: readonly string[]) => GitResult | undefined) {
  const calls: string[] = []
  const run: GitRunner = async (args) => {
    calls.push(args.join(" "))
    return script(args) ?? { stdout: "", code: 0 }
  }
  return { run, calls }
}

const clean = (args: readonly string[]): GitResult | undefined => {
  if (args[0] === "rev-parse" && args[1] === "HEAD") return { stdout: "base", code: 0 }
  return undefined // status → clean, everything else → ok
}

describe("WorktreeManager", () => {
  it("requires a git repository", async () => {
    const g = fakeGit((a) => (a[0] === "rev-parse" && a[1] === "--is-inside-work-tree" ? { stdout: "", code: 1 } : undefined))
    await expect(new WorktreeManager("/proj", g.run).begin("s", ["a"])).rejects.toThrow(/git repository/)
  })

  it("blocks on uncommitted tracked changes", async () => {
    const g = fakeGit((a) => (a[0] === "status" ? { stdout: " M file.ts", code: 0 } : clean(a)))
    await expect(new WorktreeManager("/proj", g.run).begin("s", ["a"])).rejects.toThrow(/tracked changes/)
  })

  it("ignores untracked files (checks status with --untracked-files=no)", async () => {
    const g = fakeGit(clean) // status → clean
    await new WorktreeManager("/proj", g.run).begin("s", ["a"])
    expect(g.calls).toContain("status --porcelain --untracked-files=no")
  })

  it("creates one worktree per agent and merges them on integrate", async () => {
    const g = fakeGit(clean)
    const session = await new WorktreeManager("/proj", g.run).begin("stage", ["a", "b"])
    expect(session.dirs).toHaveLength(2)
    await session.integrate([ok("a"), ok("b")], async () => {})
    expect(g.calls.filter((c) => c.startsWith("worktree add"))).toHaveLength(2)
    expect(g.calls.filter((c) => c.startsWith("merge --no-ff"))).toHaveLength(2)
  })

  it("aligns results to worktrees by ORIGINAL index when an agent is absent (a hole)", async () => {
    const g = fakeGit(clean)
    const session = await new WorktreeManager("/proj", g.run).begin("stage", ["a", "b", "c"])
    // Agent 'b' (index 1) never ran → undefined hole; the array stays full-length so
    // indices line up with branches/dirs. 'c' must merge with ITS branch, not 'b'.
    await session.integrate([ok("a"), undefined, ok("c")], async () => {})
    const merges = g.calls.filter((c) => c.startsWith("merge --no-ff"))
    expect(merges).toHaveLength(2)
    expect(merges.some((m) => m.includes("0-a"))).toBe(true)
    expect(merges.some((m) => m.includes("2-c"))).toBe(true)
    expect(merges.some((m) => m.includes("1-b"))).toBe(false) // the absent agent is never merged
  })

  it("surfaces a merge conflict without clobbering (aborts, keeps branch)", async () => {
    let logged = ""
    const g = fakeGit((a) => {
      if (a[0] === "merge" && a[1] === "--no-ff") return { stdout: "CONFLICT", code: 1 }
      return clean(a)
    })
    const session = await new WorktreeManager("/proj", g.run).begin("stage", ["a"])
    await session.integrate([ok("a")], async (m) => { logged += m })
    expect(logged).toMatch(/conflict/i)
    expect(g.calls).toContain("merge --abort")
    expect(g.calls.some((c) => c.startsWith("branch -D"))).toBe(false) // branch kept for manual integration
  })

  it("rolls back already-created worktrees if a later creation fails (no leak)", async () => {
    let adds = 0
    const g = fakeGit((a) => {
      if (a[0] === "worktree" && a[1] === "add") {
        adds++
        return adds >= 2 ? { stdout: "fatal: boom", code: 1 } : { stdout: "", code: 0 }
      }
      return clean(a)
    })
    await expect(new WorktreeManager("/proj", g.run).begin("stage", ["a", "b", "c"]))
      .rejects.toThrow(/failed to create worktree/)
    // The first, successfully-created worktree must be cleaned up before re-throwing.
    expect(g.calls.some((c) => c.startsWith("worktree remove"))).toBe(true)
    expect(g.calls.some((c) => c.startsWith("branch -D"))).toBe(true)
  })

  it("does NOT discard work when git add fails — keeps the branch and surfaces it", async () => {
    let logged = ""
    const g = fakeGit((a) => (a[0] === "add" ? { stdout: "fatal: index locked", code: 1 } : clean(a)))
    const session = await new WorktreeManager("/proj", g.run).begin("stage", ["a"])
    await session.integrate([ok("a")], async (m) => { logged += m })
    expect(logged).toMatch(/staging failed/i)
    expect(g.calls.some((c) => c.startsWith("commit"))).toBe(false)        // never reached commit
    expect(g.calls.some((c) => c.startsWith("merge --no-ff"))).toBe(false) // not merged
    expect(g.calls.some((c) => c.startsWith("branch -D"))).toBe(false)     // branch kept for recovery
  })

  it("includes the per-run id in branch names so concurrent workflows don't collide", async () => {
    const branchOf = (calls: string[]) => calls.find((c) => c.startsWith("worktree add"))!.split(" ")[3]
    const g1 = fakeGit(clean); await new WorktreeManager("/proj", g1.run).begin("deploy", ["backend"])
    const g2 = fakeGit(clean); await new WorktreeManager("/proj", g2.run).begin("deploy", ["backend"])
    const b1 = branchOf(g1.calls), b2 = branchOf(g2.calls)
    expect(b1).toMatch(/^wf\/deploy\/[a-f0-9]{8}\/0-backend$/) // run id segment present
    expect(b1).not.toBe(b2)                                    // different run → no branch collision
  })

  it("falls back to prune when git worktree remove fails (no /tmp leak)", async () => {
    const g = fakeGit((a) => (a[0] === "worktree" && a[1] === "remove" ? { stdout: "fatal: locked", code: 1 } : clean(a)))
    const session = await new WorktreeManager("/proj", g.run).begin("stage", ["a"])
    await session.integrate([ok("a")], async () => {})
    expect(g.calls).toContain("worktree prune")
  })

  it("does not merge an agent that made no changes", async () => {
    const g = fakeGit((a) => {
      if (a[0] === "commit") return { stdout: "nothing to commit", code: 1 }
      return clean(a)
    })
    const session = await new WorktreeManager("/proj", g.run).begin("stage", ["a"])
    await session.integrate([ok("a")], async () => {})
    expect(g.calls.some((c) => c.startsWith("merge --no-ff"))).toBe(false)
  })
})
