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
  // `git diff --cached --quiet` exits 1 when staged changes EXIST (the normal
  // integrate case); exit 0 means nothing staged. The default here is "changes
  // present" so the commit+merge path runs.
  if (args[0] === "diff" && args[1] === "--cached" && args[2] === "--quiet") return { stdout: "", code: 1 }
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
    // "No changes" is now detected precisely via `git diff --cached --quiet`
    // (exit 0 = nothing staged), not by assuming any non-zero commit exit means
    // "nothing to commit" (which discarded real work on hook/GPG failures).
    const g = fakeGit((a) => {
      if (a[0] === "diff" && a[1] === "--cached" && a[2] === "--quiet") return { stdout: "", code: 0 }
      return clean(a)
    })
    const session = await new WorktreeManager("/proj", g.run).begin("stage", ["a"])
    await session.integrate([ok("a")], async () => {})
    expect(g.calls.some((c) => c.startsWith("diff --cached --quiet"))).toBe(true)
    expect(g.calls.some((c) => c.startsWith("commit"))).toBe(false)        // never committed
    expect(g.calls.some((c) => c.startsWith("merge --no-ff"))).toBe(false) // not merged
  })

  it("keeps the branch when commit FAILS for a real reason (hook/GPG/identity) — no data loss", async () => {
    // ENG-WT-01: previously any non-zero commit exit was misread as "nothing to
    // commit" and the branch was force-deleted, discarding staged work. A staged
    // diff that then fails to commit must keep the branch for recovery.
    const logged: string[] = []
    const g = fakeGit((a) => {
      if (a[0] === "diff" && a[1] === "--cached" && a[2] === "--quiet") return { stdout: "", code: 1 } // changes staged
      if (a[0] === "commit") return { stdout: "husky pre-commit failed", code: 1 }
      return clean(a)
    })
    const session = await new WorktreeManager("/proj", g.run).begin("stage", ["a"])
    await session.integrate([ok("a")], async (m) => { logged.push(m) })
    expect(logged.some((m) => /commit failed/i.test(m))).toBe(true)
    expect(g.calls.some((c) => c.startsWith("merge --no-ff"))).toBe(false) // not merged
    expect(g.calls.some((c) => c.startsWith("branch -D"))).toBe(false)     // branch KEPT for recovery
  })

  it("cleanupAllActive reclaims sessions left dangling by a killed-mid-run workflow (teardown)", async () => {
    // ARCH-002: a workflow killed between begin() and integrate() leaves live
    // worktrees. The manager tracks them so plugin teardown can reclaim all.
    const g = fakeGit(clean)
    const mgr = new WorktreeManager("/proj", g.run)
    const session = await mgr.begin("stage", ["a", "b"])
    // Simulate the workflow being killed: neither integrate nor cleanup ran.
    expect(session.dirs).toHaveLength(2)
    await mgr.cleanupAllActive()
    // Both worktrees and branches were removed despite no integrate.
    expect(g.calls.filter((c) => c.startsWith("worktree remove"))).toHaveLength(2)
    expect(g.calls.filter((c) => c.startsWith("branch -D"))).toHaveLength(2)
  })

  it("cleanupAllActive drains the active set and is a no-op when nothing is active", async () => {
    const g = fakeGit(clean)
    const mgr = new WorktreeManager("/proj", g.run)
    // Nothing begun yet — must not throw and must issue no git commands.
    await expect(mgr.cleanupAllActive()).resolves.toBeUndefined()
    expect(g.calls.length).toBe(0)

    // Begin two sessions without integrate/cleanup (simulating killed workflows).
    await mgr.begin("stage", ["a"])
    await mgr.begin("other", ["b"])
    const before = g.calls.filter((c) => c.startsWith("worktree remove")).length
    await mgr.cleanupAllActive()
    // Both sessions' worktrees reclaimed.
    expect(g.calls.filter((c) => c.startsWith("worktree remove")).length - before).toBe(2)
    // A second cleanup is a no-op — the set was drained.
    const drained = g.calls.length
    await mgr.cleanupAllActive()
    expect(g.calls.length).toBe(drained)
  })
})
