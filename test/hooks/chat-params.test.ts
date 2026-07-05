import { describe, it, expect } from "vitest"
import { setMaxThinkingEffort } from "../../src/hooks/chat-params"

describe("setMaxThinkingEffort", () => {
  it("sets Anthropic thinking budget", () => {
    const out = { options: {} as Record<string, unknown> }
    setMaxThinkingEffort({ providerID: "anthropic", id: "claude-sonnet" }, out)
    expect(out.options.thinking).toBeDefined()
    expect((out.options.thinking as any).budgetTokens).toBe(31_999)
  })

  it("sets OpenAI reasoning effort", () => {
    const out = { options: {} as Record<string, unknown> }
    setMaxThinkingEffort({ providerID: "openai", id: "gpt-5" }, out)
    expect(out.options.reasoningEffort).toBe("xhigh")
  })

  it("sets Google thinking config", () => {
    const out = { options: {} as Record<string, unknown> }
    setMaxThinkingEffort({ providerID: "google", id: "gemini-pro" }, out)
    expect(out.options.thinkingConfig).toBeDefined()
  })

  it("does nothing for unknown providers", () => {
    const out = { options: {} as Record<string, unknown> }
    setMaxThinkingEffort({ providerID: "unknown", id: "model" }, out)
    expect(Object.keys(out.options)).toHaveLength(0)
  })

  it("matches by model name when providerID is empty", () => {
    const out = { options: {} as Record<string, unknown> }
    setMaxThinkingEffort({ providerID: "", id: "claude-4-haiku" }, out)
    expect(out.options.thinking).toBeDefined()
  })
})
