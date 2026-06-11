import { describe, it, expect, beforeEach, vi } from "vitest"
import { ClassifierSession } from "../../src/auto-mode/stage2"
import { createMockSdk } from "../helpers/mock-sdk"
import { compileConfig } from "../../src/config"
import type { CompiledAutoModeConfig, ClassificationRequest } from "../../src/contracts"
import type { AgentRun } from "../../src/sdk-client"

const baseConfig = (raw: Record<string, unknown> = {}): CompiledAutoModeConfig =>
  compileConfig({ autoMode: { enabled: true, ...raw } }).autoMode

const req = (over: Partial<ClassificationRequest> = {}): ClassificationRequest => ({
  tool: "bash", params: "git status", userMessage: "", boundaries: [], ...over,
})

/** Make an override that returns the given classifier text as an AgentRun. */
const reply = (text: string) => async (): Promise<AgentRun> => ({ text, cost: 0, tokens: 0 })

describe("ClassifierSession", () => {
  let mock: ReturnType<typeof createMockSdk>
  let classifier: ClassifierSession

  beforeEach(() => {
    mock = createMockSdk()
    classifier = new ClassifierSession(mock.sdk)
  })

  it("runs each classify as an independent turn: a fresh session, created and deleted", async () => {
    ;(mock.sdk as any).promptSession = reply("ALLOW|ok")
    await classifier.classify(req(), baseConfig())
    await classifier.classify(req(), baseConfig())
    // Fresh per call (no shared history): one create + one delete per classify.
    expect(mock.calls.filter((c) => c.method === "createSession")).toHaveLength(2)
    expect(mock.calls.filter((c) => c.method === "deleteSession")).toHaveLength(2)
  })

  it("never passes noReply — the model MUST reply with a verdict", async () => {
    let sawNoReply: unknown = "unset"
    ;(mock.sdk as any).promptSession = async (_id: string, opts: any): Promise<AgentRun> => {
      sawNoReply = opts.noReply; return { text: "ALLOW|ok", cost: 0, tokens: 0 }
    }
    await classifier.classify(req(), baseConfig())
    expect(sawNoReply).toBeUndefined() // regression guard for the fail-closed-on-every-call bug
  })

  it("parses ALLOW and DENY", async () => {
    ;(mock.sdk as any).promptSession = reply("ALLOW|safe operation")
    expect(await classifier.classify(req(), baseConfig())).toEqual({ verdict: "ALLOW", reason: "safe operation" })
    ;(mock.sdk as any).promptSession = reply("DENY|force push to main")
    expect(await classifier.classify(req(), baseConfig())).toEqual({ verdict: "DENY", reason: "force push to main" })
  })

  it("DEFERS on unparseable output (auto mode steps aside, never a manufactured deny)", async () => {
    ;(mock.sdk as any).promptSession = reply("I think this is probably fine")
    expect((await classifier.classify(req(), baseConfig())).verdict).toBe("DEFER")
  })

  it("parses leniently when the verdict is wrapped or alternately separated", async () => {
    const cases: Array<[string, "ALLOW" | "DENY"]> = [
      ["ALLOW: looks fine", "ALLOW"],
      ["ALLOW - safe read", "ALLOW"],
      ["DENY > deletes data", "DENY"],
      ["The verdict is ALLOW because it only reads.", "ALLOW"],
      ["This deletes production, so DENY.", "DENY"],
    ]
    for (const [text, verdict] of cases) {
      ;(mock.sdk as any).promptSession = reply(text)
      expect((await classifier.classify(req(), baseConfig())).verdict, text).toBe(verdict)
    }
  })

  it("DEFERS on empty output or contradictory verdicts", async () => {
    for (const text of ["", "   ", "ALLOW or DENY, hard to say"]) {
      ;(mock.sdk as any).promptSession = reply(text)
      expect((await classifier.classify(req(), baseConfig())).verdict, JSON.stringify(text)).toBe("DEFER")
    }
  })

  it("DEFERS (not denies) when the classifier is unavailable", async () => {
    ;(mock.sdk as any).promptSession = async () => { throw new Error("network down") }
    const result = await classifier.classify(req(), baseConfig())
    expect(result.verdict).toBe("DEFER")
    expect(result.reason).toMatch(/unavailable/i)
  })

  it("deletes the fresh session even when the prompt throws", async () => {
    ;(mock.sdk as any).promptSession = async () => { throw new Error("boom") }
    await classifier.classify(req(), baseConfig())
    expect(mock.calls.filter((c) => c.method === "deleteSession")).toHaveLength(1)
  })

  it("includes rules, the user message, and boundaries in the prompt", async () => {
    let system = ""
    let user = ""
    ;(mock.sdk as any).promptSession = async (_id: string, opts: any): Promise<AgentRun> => {
      system = opts.system; user = opts.parts[0].text; return { text: "ALLOW|ok", cost: 0, tokens: 0 }
    }
    await classifier.classify(
      req({ userMessage: "push it", boundaries: ["do not deploy"] }),
      baseConfig({ hardDeny: ["Never push to main"] }),
    )
    expect(system).toContain("security classifier")
    // The authoritative instructions (rules included) live in the user prompt.
    expect(user).toContain("Never push to main")
    expect(user).toContain("push it")
    expect(user).toContain("do not deploy")
    expect(user).toMatch(/ALLOW\|/)
  })

  it("routes to the configured small model when set", async () => {
    let model: unknown
    ;(mock.sdk as any).promptSession = async (_id: string, opts: any): Promise<AgentRun> => {
      model = opts.model; return { text: "ALLOW|ok", cost: 0, tokens: 0 }
    }
    await classifier.classify(req(), baseConfig({ classifier: { model: "anthropic/claude-haiku-4-5" } }))
    expect(model).toEqual({ providerID: "anthropic", modelID: "claude-haiku-4-5" })
  })

  it("omits the model override when none is configured", async () => {
    let opts: any
    ;(mock.sdk as any).promptSession = async (_id: string, o: any): Promise<AgentRun> => {
      opts = o; return { text: "ALLOW|ok", cost: 0, tokens: 0 }
    }
    await classifier.classify(req(), baseConfig())
    expect(opts.model).toBeUndefined()
  })

  describe("verifyAgent", () => {
    it("does not warn when the classifier agent exists", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
      await classifier.verifyAgent(baseConfig()) // default agent "general" is in the mock list
      expect(warn).not.toHaveBeenCalled()
      warn.mockRestore()
    })

    it("warns once when the classifier agent is missing", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
      const cfg = baseConfig({ classifier: { agent: "ghost-agent" } })
      await classifier.verifyAgent(cfg)
      await classifier.verifyAgent(cfg) // second call is a no-op (once-guard)
      expect(warn).toHaveBeenCalledTimes(1)
      expect(warn.mock.calls[0]![0]).toMatch(/ghost-agent/)
      warn.mockRestore()
    })
  })

  describe("detectInjection", () => {
    it("returns false only for an explicit SAFE", async () => {
      ;(mock.sdk as any).promptSession = reply("SAFE")
      expect(await classifier.detectInjection("content", baseConfig())).toBe(false)
    })
    it("treats INJECTION (and anything unclear) as an injection", async () => {
      ;(mock.sdk as any).promptSession = reply("INJECTION")
      expect(await classifier.detectInjection("content", baseConfig())).toBe(true)
      ;(mock.sdk as any).promptSession = reply("uh, maybe?")
      expect(await classifier.detectInjection("content", baseConfig())).toBe(true)
    })
    it("fails closed (injection) when the detector throws", async () => {
      ;(mock.sdk as any).promptSession = async () => { throw new Error("down") }
      expect(await classifier.detectInjection("content", baseConfig())).toBe(true)
    })
  })
})
