/**
 * Run journal. Writes are atomic (temp+rename). Cache keys are cumulative
 * (chain hash) so an upstream edit invalidates downstream. Old files are GC'd.
 */
import * as fs from "node:fs/promises"
import * as path from "node:path"
import * as crypto from "node:crypto"
import { type Stage, type StageResult, type WorkflowDef } from "../contracts.js"
import { type LogLevel } from "../sdk-client.js"
import { errMsg } from "../util.js"

type Log = (level: LogLevel, message: string) => void

export function stageHash(stage: Stage): string {
  return crypto.createHash("sha1").update(JSON.stringify(stage)).digest("hex").slice(0, 16)
}

/** Cumulative hash of stages[0..upto]. Upstream edit invalidates downstream. */
export function chainStageHash(stages: readonly Stage[], uptoInclusive: number): string {
  const h = crypto.createHash("sha1")
  for (let i = 0; i <= uptoInclusive; i++) h.update(stageHash(stages[i]!))
  return h.digest("hex").slice(0, 16)
}

export interface Journal {
  load(index: number, hash: string): StageResult | undefined
  save(index: number, hash: string, result: StageResult): Promise<void>
}

interface JournalFile {
  runId: string
  def: WorkflowDef
  stages: Record<string, { hash: string; result: StageResult }>
}

export class FileJournal implements Journal {
  private constructor(
    private readonly filePath: string,
    private readonly data: JournalFile,
    private readonly log?: Log,
  ) {}

  /** Open (or create) the journal for a run, loading any prior progress for the same runId. */
  static async open(
    dir: string,
    runId: string,
    def: WorkflowDef,
    log?: Log,
    maxJournalFiles = 100,
  ): Promise<FileJournal> {
    const filePath = path.join(dir, `${runId}.json`)
    let data: JournalFile = { runId, def, stages: {} }
    const existing = await readJournal(filePath, log)
    if (existing && existing.runId === runId) data = { ...existing, def }
    // Best-effort GC: cap retained journals so the directory can't grow unbounded.
    // Never throws — a GC failure must not block the workflow from running.
    try { await pruneJournalDir(dir, maxJournalFiles, filePath, log) }
    catch (err) { log?.("warn", `journal GC failed: ${errMsg(err)}`) }
    return new FileJournal(filePath, data, log)
  }

  /** Read a journal's stored definition + progress (for the resume action). */
  static async read(dir: string, runId: string): Promise<{ def: WorkflowDef } | undefined> {
    const file = await readJournal(path.join(dir, `${runId}.json`))
    return file ? { def: file.def } : undefined
  }

  load(index: number, hash: string): StageResult | undefined {
    const entry = this.data.stages[String(index)]
    return entry && entry.hash === hash ? entry.result : undefined
  }

  async save(index: number, hash: string, result: StageResult): Promise<void> {
    this.data.stages[String(index)] = { hash, result }
    try {
      await fs.mkdir(path.dirname(this.filePath), { recursive: true })
      // Atomic write: write the full journal to a temp file, then rename. A crash
      // between write and rename leaves the previous good file intact (rename is
      // atomic on the same filesystem) — never a truncated/corrupt journal that
      // would lose ALL prior progress.
      const tmp = `${this.filePath}.tmp`
      await fs.writeFile(tmp, JSON.stringify(this.data, null, 2), "utf-8")
      await fs.rename(tmp, this.filePath)
    } catch (err) {
      this.log?.("warn", `could not write workflow journal: ${errMsg(err)}`)
    }
  }
}

async function readJournal(filePath: string, log?: Log): Promise<JournalFile | undefined> {
  let raw: string
  try {
    raw = await fs.readFile(filePath, "utf-8")
  } catch {
    return undefined // file does not exist — normal, not an error
  }
  try {
    return JSON.parse(raw) as JournalFile
  } catch (err) {
    // File exists but is corrupt/truncated. Distinguish this from "file not
    // found" so a bit-flipped or partially-written journal doesn't silently
    // masquerade as a missing one, losing all resume progress.
    log?.("warn", `journal file ${filePath} exists but is not valid JSON (${errMsg(err)}) — all cached progress lost`)
    return undefined
  }
}

/**
 * Retain at most `maxFiles` journal files, evicting the oldest by mtime. The
 * `keepFile` (the run being opened) is always preserved. Best-effort: individual
 * unlink failures are skipped, not thrown.
 */
async function pruneJournalDir(dir: string, maxFiles: number, keepFile: string, log?: Log): Promise<void> {
  let entries: string[]
  try {
    entries = await fs.readdir(dir)
  } catch {
    return // dir doesn't exist yet — nothing to prune
  }
  const journals = entries.filter((f) => f.endsWith(".json") || f.endsWith(".json.tmp"))
  if (journals.length <= maxFiles) return

  const stamped = await Promise.all(
    journals.map(async (f) => {
      const p = path.join(dir, f)
      try { return { f: p, mtime: (await fs.stat(p)).mtimeMs } as const }
      catch { return { f: p, mtime: Number.POSITIVE_INFINITY } as const } // keep files we can't stat
    }),
  )
  // Evict oldest until we're at the cap; always preserve keepFile + any *.tmp.
  const evict = stamped
    .filter((s) => s.f !== keepFile)
    .sort((a, b) => a.mtime - b.mtime)
    .slice(0, stamped.length - maxFiles)
  for (const { f } of evict) {
    try { await fs.unlink(f) }
    catch (err) { log?.("warn", `journal GC could not remove '${f}': ${errMsg(err)}`) }
  }
}
