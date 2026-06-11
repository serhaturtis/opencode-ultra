/**
 * Run journal — persists each completed stage's result so a workflow can resume,
 * re-running only stages whose definition changed (hash mismatch) or never ran.
 * The journal also stores the WorkflowDef so a run can be reconstructed after a
 * restart. Journal writes are best-effort: a write failure degrades resume only
 * and is logged, never aborting the workflow's real work.
 */
import * as fs from "node:fs/promises"
import * as path from "node:path"
import * as crypto from "node:crypto"
import { type Stage, type StageResult, type WorkflowDef } from "../contracts.js"

/** Stable content hash of a stage definition; a changed stage invalidates its cached result. */
export function stageHash(stage: Stage): string {
  return crypto.createHash("sha1").update(JSON.stringify(stage)).digest("hex").slice(0, 16)
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
  ) {}

  /** Open (or create) the journal for a run, loading any prior progress for the same runId. */
  static async open(dir: string, runId: string, def: WorkflowDef): Promise<FileJournal> {
    const filePath = path.join(dir, `${runId}.json`)
    let data: JournalFile = { runId, def, stages: {} }
    const existing = await readJournal(filePath)
    if (existing && existing.runId === runId) data = { ...existing, def }
    return new FileJournal(filePath, data)
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
      await fs.writeFile(this.filePath, JSON.stringify(this.data, null, 2), "utf-8")
    } catch (err) {
      console.warn(`[opencode-ultra] could not write workflow journal: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
}

async function readJournal(filePath: string): Promise<JournalFile | undefined> {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf-8")) as JournalFile
  } catch {
    return undefined
  }
}
