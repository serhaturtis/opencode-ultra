import { describe, it, expect, afterEach } from "vitest"
import * as os from "node:os"
import * as path from "node:path"
import * as fs from "node:fs/promises"
import { randomUUID } from "node:crypto"
import { FileJournal, stageHash, chainStageHash } from "../../src/ultracode/journal"
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

  it("writes atomically — a corrupt/partial file is never observed (ENG-JR-05)", async () => {
    // After a successful save, the file is valid JSON. A simulated crash mid-write
    // would leave the PREVIOUS good file (temp+rename is atomic); verify the happy
    // path round-trips and that no .tmp litter remains after a clean save.
    const dir = tmpDir()
    const j = await FileJournal.open(dir, "atomic", def)
    await j.save(0, stageHash(stage), result)
    const files = await fs.readdir(dir)
    expect(files.some((f) => f.endsWith(".tmp"))).toBe(false) // temp cleaned up by rename
    const reopened = await FileJournal.open(dir, "atomic", def)
    expect(reopened.load(0, stageHash(stage))).toEqual(result)
  })

  it("chainStageHash: editing an upstream stage invalidates downstream cache (ARCH-011)", async () => {
    const s1: Stage = { kind: "fanout", name: "a", agents: [{ name: "x", task: "t", agent: "explore" }] }
    const s2: Stage = { kind: "fanout", name: "b", agents: [{ name: "y", task: "t", agent: "explore" }] }
    const two: WorkflowDef = { title: "T", stages: [s1, s2] }
    const dir = tmpDir()
    const j = await FileJournal.open(dir, "chain", two)
    const hashB = chainStageHash(two.stages, 1)
    await j.save(1, hashB, { stage: "b", kind: "fanout", agents: [], findings: [] })
    expect(j.load(1, hashB)).toBeDefined()

    // Edit the UPSTREAM stage s1. Stage b's chain hash must change → cache miss.
    const s1Edited: Stage = { kind: "fanout", name: "a", agents: [{ name: "x", task: "DIFFERENT", agent: "explore" }] }
    const edited: WorkflowDef = { title: "T", stages: [s1Edited, s2] }
    const hashBAfter = chainStageHash(edited.stages, 1)
    expect(hashBAfter).not.toBe(hashB)
    expect(j.load(1, hashBAfter)).toBeUndefined() // upstream edit → downstream invalidated
  })

  it("garbage-collects old journal files beyond the retention cap (ARCH-016)", async () => {
    const dir = tmpDir()
    const files = async () => (await fs.readdir(dir)).filter((f) => f.endsWith(".json"))
    // Seed 5 journals with a HIGH retention so none are pruned during seeding
    // (each open runs GC, so the cap must exceed the seed count).
    for (let i = 0; i < 5; i++) {
      const j = await FileJournal.open(dir, `run${i}`, def, undefined, 100)
      await j.save(0, stageHash(stage), result)
    }
    expect((await files()).length).toBe(5)
    // Opening with a retention cap of 3 prunes down to ≤3, keeping the opened run.
    await FileJournal.open(dir, "run0", def, undefined, 3)
    expect((await files()).length).toBeLessThanOrEqual(3)
    expect((await files())).toContain("run0.json") // the opened run is always retained
  })
})
