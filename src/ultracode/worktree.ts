/**
 * Worktree isolation — runs each agent of an `isolate: true` fanout stage in its
 * own git worktree/branch so concurrent edits can't clobber each other, then
 * integrates them sequentially.
 *
 * Safety boundaries (fail-fast, never clobber):
 *  - requires a git repository and a CLEAN working tree;
 *  - each agent commits to its own branch off HEAD;
 *  - branches merge into HEAD one at a time; a conflict aborts that merge and the
 *    branch is left for manual integration (surfaced, not silently resolved).
 *
 * The git runner is injected so it can be faked in tests.
 */
import * as path from "node:path"
import * as os from "node:os"
import * as fs from "node:fs/promises"
import * as crypto from "node:crypto"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { type AgentResult } from "../contracts.js"

export interface GitResult { readonly stdout: string; readonly code: number }
export type GitRunner = (args: readonly string[], cwd: string) => Promise<GitResult>

const execFileP = promisify(execFile)
const defaultGit: GitRunner = async (args, cwd) => {
  try {
    const { stdout } = await execFileP("git", [...args], { cwd })
    return { stdout, code: 0 }
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; code?: number }
    return { stdout: `${e.stdout ?? ""}${e.stderr ?? ""}`, code: typeof e.code === "number" ? e.code : 1 }
  }
}

export interface IsolationSession {
  /** Worktree directory per agent index. */
  readonly dirs: readonly string[]
  /**
   * Commit each agent's changes and merge them into HEAD; clean up afterward.
   * `results` is indexed by ORIGINAL agent position (same as dirs/branches): a hole
   * (undefined = an agent that never ran) is cleaned up, not merged.
   */
  integrate(results: readonly (AgentResult | undefined)[], log: (message: string) => Promise<void>): Promise<void>
}

export class WorktreeManager {
  constructor(
    private readonly projectDir: string,
    private readonly git: GitRunner = defaultGit,
  ) {}

  async begin(stageName: string, agentNames: readonly string[]): Promise<IsolationSession> {
    if ((await this.git(["rev-parse", "--is-inside-work-tree"], this.projectDir)).code !== 0) {
      throw new Error("worktree isolation requires a git repository")
    }
    // Only *tracked* changes block isolation; untracked files are fine (git's own
    // merge refuses to overwrite an untracked file, which we surface as a conflict).
    if ((await this.git(["status", "--porcelain", "--untracked-files=no"], this.projectDir)).stdout.trim() !== "") {
      throw new Error("worktree isolation requires no uncommitted tracked changes (commit or stash them first)")
    }
    const base = (await this.git(["rev-parse", "HEAD"], this.projectDir)).stdout.trim()
    const slug = sanitize(stageName)
    const run = crypto.randomUUID().slice(0, 8)

    const branches: string[] = []
    const dirs: string[] = []
    try {
      for (let i = 0; i < agentNames.length; i++) {
        // Include the per-run id in the BRANCH too (not just the dir): two concurrent
        // isolate workflows with the same stage/agent names would otherwise collide on
        // the branch name and crash the second one.
        const branch = `wf/${slug}/${run}/${i}-${sanitize(agentNames[i]!)}`
        const dir = path.join(os.tmpdir(), `oc-ultra-${slug}-${run}-${i}`)
        const added = await this.git(["worktree", "add", "-b", branch, dir, base], this.projectDir)
        if (added.code !== 0) throw new Error(`failed to create worktree '${dir}': ${added.stdout.trim()}`)
        branches.push(branch)
        dirs.push(dir)
      }
    } catch (err) {
      // Fail fast, but never leak half-created worktrees/branches: roll back the
      // ones already added before re-throwing.
      for (let i = 0; i < dirs.length; i++) await this.remove(dirs[i]!, branches[i]!).catch(() => {})
      throw err
    }

    return {
      dirs,
      integrate: (results, log) => this.integrate(stageName, agentNames, branches, dirs, results, log),
    }
  }

  private async integrate(
    stageName: string,
    agentNames: readonly string[],
    branches: readonly string[],
    dirs: readonly string[],
    results: readonly (AgentResult | undefined)[],
    log: (message: string) => Promise<void>,
  ): Promise<void> {
    for (let i = 0; i < dirs.length; i++) {
      const dir = dirs[i]!
      const branch = branches[i]!
      if (results[i]?.status !== "completed") {
        await this.remove(dir, branch)
        continue
      }
      const added = await this.git(["add", "-A"], dir)
      if (added.code !== 0) {
        // Staging FAILED (not "no changes"): surface it and KEEP the branch so the
        // agent's work is recoverable rather than silently discarded.
        await log(`Worktree staging failed for agent '${agentNames[i]}' (${added.stdout.trim()}); left on branch '${branch}' for manual recovery.`)
        await this.removeWorktree(dir)
        continue
      }
      const committed = await this.git(["commit", "-m", `wf: ${stageName} / ${agentNames[i]}`], dir)
      if (committed.code !== 0) {
        // Genuinely nothing to commit — the agent made no file changes.
        await this.remove(dir, branch)
        continue
      }
      const merged = await this.git(["merge", "--no-ff", "-m", `wf merge: ${branch}`, branch], this.projectDir)
      if (merged.code !== 0) {
        await this.git(["merge", "--abort"], this.projectDir)
        await log(`Worktree merge conflict from agent '${agentNames[i]}'; left on branch '${branch}' for manual integration.`)
        await this.removeWorktree(dir) // keep the branch
        continue
      }
      await this.remove(dir, branch)
    }
  }

  private async remove(dir: string, branch: string): Promise<void> {
    await this.removeWorktree(dir)
    await this.git(["branch", "-D", branch], this.projectDir)
  }

  private async removeWorktree(dir: string): Promise<void> {
    const res = await this.git(["worktree", "remove", "--force", dir], this.projectDir)
    if (res.code !== 0) {
      // git couldn't remove it — delete the directory directly so /tmp doesn't
      // accumulate, then prune the now-stale worktree registration.
      await fs.rm(dir, { recursive: true, force: true }).catch(() => {})
      await this.git(["worktree", "prune"], this.projectDir)
    }
  }
}

function sanitize(name: string): string {
  return name.replace(/[^a-z0-9]+/gi, "-").toLowerCase().replace(/^-|-$/g, "") || "agent"
}
