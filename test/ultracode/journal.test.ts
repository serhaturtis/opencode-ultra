import { describe, it, expect, afterEach } from "vitest"
import * as os from "node:os"
import * as path from "node:path"
import * as fs from "node:fs/promises"
import { randomUUID } from "node:crypto"
import { FileJournal, stageHash } from "../../src/ultracode/journal"
import type { Stage, StageResult, WorkflowDef } from "../../src/contracts"

const stage: Stage = { kind: "fanout", name: "a", agents: [{ name: "x", task: "t", agent: "explore" }] }
const result: StageResult = { stage: "a", kind: "fanout", agents: [], findings: [] }
const def: WorkflowDef = { title: "T", stages: [stage] }

const dirs: string[] = []
const tmpDir = () => { const d = path.join(os.tmpdir(), `ocu-${randomUUID()}`); dirs.push(d); return d }
afterEach(async () => { for (const d of dirs.splice(0)) await fs.rm(d, { recursive: true, force: true }) })

describe("FileJournal", () => {
  it("saves and loads a stage result by index + hash", async () => {
    const dir = tmpDir()
    const j = await FileJournal.open(dir, "run1", def)
    expect(j.load(0, stageHash(stage))).toBeUndefined()
    await j.save(0, stageHash(stage), result)

    const reopened = await FileJournal.open(dir, "run1", def)
    expect(reopened.load(0, stageHash(stage))).toEqual(result)
  })

  it("invalidates a cached result when the stage definition changes", async () => {
    const dir = tmpDir()
    const j = await FileJournal.open(dir, "run1", def)
    await j.save(0, stageHash(stage), result)
    expect(j.load(0, "a-different-hash")).toBeUndefined()
  })

  it("read() returns the stored definition for resume", async () => {
    const dir = tmpDir()
    const j = await FileJournal.open(dir, "run2", def)
    await j.save(0, stageHash(stage), result)
    const stored = await FileJournal.read(dir, "run2")
    expect(stored?.def.title).toBe("T")
  })

  it("read() returns undefined for an unknown run", async () => {
    expect(await FileJournal.read(tmpDir(), "missing")).toBeUndefined()
  })
})
