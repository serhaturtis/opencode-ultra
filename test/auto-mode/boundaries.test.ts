import { describe, it, expect } from "vitest"
import { captureBoundaries, formatBoundaries } from "../../src/auto-mode/boundaries"

describe("captureBoundaries", () => {
  it("captures explicit action constraints", () => {
    const b: string[] = []
    captureBoundaries(b, "Please don't push to main today. Also wait for review before deploying.")
    expect(b.length).toBeGreaterThanOrEqual(2)
    expect(b.join(" ")).toMatch(/push/i)
    expect(b.join(" ")).toMatch(/review|deploy/i)
  })

  it("ignores non-constraint sentences", () => {
    const b: string[] = []
    captureBoundaries(b, "I don't think this is right. The build passed.")
    expect(b).toHaveLength(0)
  })

  it("captures 'no deploys' style constraints", () => {
    const b: string[] = []
    captureBoundaries(b, "No deploys today.")
    expect(b).toHaveLength(1)
  })

  it("dedups repeated constraints", () => {
    const b: string[] = []
    captureBoundaries(b, "do not deploy.")
    captureBoundaries(b, "do not deploy.")
    expect(b).toHaveLength(1)
  })

  it("is bounded (drops oldest beyond the cap)", () => {
    const b: string[] = []
    for (let i = 0; i < 20; i++) captureBoundaries(b, `do not deploy variant ${i}.`)
    expect(b.length).toBeLessThanOrEqual(12)
  })
})

describe("formatBoundaries", () => {
  it("returns empty string when there are no boundaries", () => {
    expect(formatBoundaries([])).toBe("")
  })

  it("renders a labelled list", () => {
    const out = formatBoundaries(["do not deploy"])
    expect(out).toContain("standing instructions")
    expect(out).toContain("do not deploy")
  })
})
