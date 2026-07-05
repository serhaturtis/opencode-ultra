/**
 * Plugin-level integration tests.
 *
 * These instantiate the actual plugin entry point and drive its hooks against a
 * fake OpencodeClient whose call/response shapes match the real @opencode-ai/sdk.
 * This is the layer that previously hid real-API mismatches; it now also pins the
 * per-session behavior (state keyed by sessionID, chat.message capture, etc.).
 */
import { describe, it, expect, vi } from "vitest"
import plugin from "../../src/index"

function makeFakeClient() {
  const calls: Array<[string, any]> = []
  let n = 0
  const client = {
    session: {
      create: async (opts: any) => { calls.push(["create", opts]); return { data: { id: `s${++n}` } } },
      prompt: async (opts: any) => { calls.push(["prompt", opts]); return { data: { parts: [{ type: "text", text: "ALLOW|ok" }] } } },
      delete: async (opts: any) => { calls.push(["delete", opts]); return { data: {} } },
    },
    app: {
      agents: async () => ({ data: [{ name: "title" }, { name: "build" }, { name: "general" }, { name: "explore" }] }),
    },
  }
  return { client, calls }
}

// Settings are passed as the plugin entry's options (second argument), the way
// opencode delivers a [ref, options] plugin tuple.
async function makePlugin(options?: any) {
  const { client, calls } = makeFakeClient()
  const hooks: any = await plugin({ client, directory: "/home/user/project" } as any, options)
  return { hooks, calls }
}

const ENABLED = { autoMode: { enabled: true, defaultMode: true } }
const userMessage = (text: string) => ({ message: { role: "user" }, parts: [{ type: "text", text }] })

describe("plugin: activation gating", () => {
  it("stays inert when auto mode is disabled", async () => {
    const { hooks, calls } = await makePlugin()
    await hooks["tool.execute.before"]({ tool: "bash", sessionID: "x", callID: "c1" }, { args: { command: "npm test" } })
    const out = { status: "ask" as const }
    await hooks["permission.ask"]({ sessionID: "x", callID: "c1" }, out)
    expect(out.status).toBe("ask")
    expect(calls.length).toBe(0) // no classifier session created
  })

  it("/auto on activates a session when enabled but not defaultMode", async () => {
    const { hooks } = await makePlugin({ autoMode: { enabled: true, defaultMode: false } })
    const before = { status: "ask" as const }
    await hooks["tool.execute.before"]({ tool: "bash", sessionID: "s", callID: "c1" }, { args: { command: "npm test" } })
    await hooks["permission.ask"]({ sessionID: "s", callID: "c1" }, before)
    expect(before.status).toBe("ask") // not active yet

    const cmdOut: any = { parts: [] }
    await hooks["command.execute.before"]({ command: "auto", arguments: "", sessionID: "s" }, cmdOut)
    expect(cmdOut.parts[0].text).toContain("ENABLED")
  })

  it("/auto is refused when disabled by config", async () => {
    const { hooks } = await makePlugin({ autoMode: { enabled: false } })
    const cmdOut: any = { parts: [] }
    await hooks["command.execute.before"]({ command: "auto", arguments: "on", sessionID: "s" }, cmdOut)
    expect(cmdOut.parts[0].text.toLowerCase()).toContain("disabled")
  })

  it("keeps sessions isolated", async () => {
    const { hooks } = await makePlugin(ENABLED)
    // Turn auto mode off in session A only.
    await hooks["command.execute.before"]({ command: "auto", arguments: "off", sessionID: "A" }, { parts: [] })
    // Session B is still active: a catastrophic command is denied there.
    const out = { status: "ask" as const }
    await expect(
      hooks["tool.execute.before"]({ tool: "bash", sessionID: "B", callID: "b1" }, { args: { command: "rm -rf /" } }),
    ).rejects.toThrow()
    await hooks["permission.ask"]({ sessionID: "B", callID: "b1" }, out)
    expect(out.status).toBe("deny")
    // Session A is off: the before-hook does nothing (no throw).
    await hooks["tool.execute.before"]({ tool: "bash", sessionID: "A", callID: "a1" }, { args: { command: "rm -rf /" } })
  })
})

describe("plugin: permission.ask enforces cached verdicts", () => {
  it("auto-allows a Stage-1 ALLOW action", async () => {
    const { hooks } = await makePlugin(ENABLED)
    await hooks["tool.execute.before"]({ tool: "bash", sessionID: "x", callID: "c1" }, { args: { command: "npm test" } })
    const out = { status: "ask" as const }
    await hooks["permission.ask"]({ sessionID: "x", callID: "c1" }, out)
    expect(out.status).toBe("allow")
  })

  it("auto-denies a Stage-1 catastrophic action (and the before-hook throws)", async () => {
    const { hooks } = await makePlugin(ENABLED)
    await expect(
      hooks["tool.execute.before"]({ tool: "bash", sessionID: "x", callID: "c2" }, { args: { command: "rm -rf /" } }),
    ).rejects.toThrow()
    const out = { status: "ask" as const }
    await hooks["permission.ask"]({ sessionID: "x", callID: "c2" }, out)
    expect(out.status).toBe("deny")
  })

  it("never writes to the terminal (console) — that would corrupt opencode's TUI", async () => {
    const spies = (["log", "warn", "error", "info", "debug"] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => {}),
    )
    try {
      const { hooks } = await makePlugin(ENABLED) // init (incl. classifier verify) must not console
      // A denial — the one path that used to console.warn an audit line.
      await hooks["tool.execute.before"]({ tool: "bash", sessionID: "x", callID: "c4" }, { args: { command: "rm -rf /" } })
        .catch(() => {})
      for (const s of spies) expect(s).not.toHaveBeenCalled()
    } finally {
      for (const s of spies) s.mockRestore()
    }
  })

  it("routes a FLAGGED action through the classifier and unwraps the response", async () => {
    const { hooks, calls } = await makePlugin(ENABLED)
    await hooks["tool.execute.before"]({ tool: "bash", sessionID: "x", callID: "c3" }, { args: { command: "git push origin dev" } })
    expect(calls.some((c) => c[0] === "prompt")).toBe(true) // classifier was consulted
    const out = { status: "ask" as const }
    await hooks["permission.ask"]({ sessionID: "x", callID: "c3" }, out)
    expect(out.status).toBe("allow")
  })

  it("DEFERS to the user when the classifier can't decide (no throw, no auto-verdict)", async () => {
    const calls: Array<[string, any]> = []
    let n = 0
    const client = {
      session: {
        create: async (o: any) => { calls.push(["create", o]); return { data: { id: `s${++n}` } } },
        prompt: async (o: any) => { calls.push(["prompt", o]); return { data: { parts: [{ type: "text", text: "uh, not sure" }] } } },
        delete: async (o: any) => { calls.push(["delete", o]); return { data: {} } },
      },
      app: { agents: async () => ({ data: [{ name: "general" }] }) },
    }
    const hooks: any = await plugin({ client, directory: "/p" } as any, ENABLED)
    // FLAGGED → classifier → unparseable → DEFER: must NOT throw.
    await hooks["tool.execute.before"]({ tool: "bash", sessionID: "x", callID: "d1" }, { args: { command: "git push origin dev" } })
    // Nothing cached → permission.ask falls through to the normal prompt.
    const out = { status: "ask" as const }
    await hooks["permission.ask"]({ sessionID: "x", callID: "d1" }, out)
    expect(out.status).toBe("ask")
  })

  it("leaves uncached / non-tool permissions to the user", async () => {
    const { hooks } = await makePlugin(ENABLED)
    const out = { status: "ask" as const }
    await hooks["permission.ask"]({ sessionID: "x", callID: "never" }, out)
    expect(out.status).toBe("ask")
    const out2 = { status: "ask" as const }
    await hooks["permission.ask"]({ sessionID: "x" }, out2) // no callID (plan/question)
    expect(out2.status).toBe("ask")
  })
})

describe("plugin: chat.message capture (per session)", () => {
  it("detects the ultracode: keyword and raises thinking effort", async () => {
    const { hooks } = await makePlugin(ENABLED)
    await hooks["chat.message"]({ sessionID: "x" }, userMessage("ultracode: build the thing"))
    const params: any = { options: {} }
    await hooks["chat.params"]({ sessionID: "x", model: { providerID: "anthropic", id: "claude-opus" } }, params)
    expect(params.options.thinking).toBeDefined()
  })

  it("does not raise thinking effort for an ordinary message", async () => {
    const { hooks } = await makePlugin(ENABLED)
    await hooks["chat.message"]({ sessionID: "x" }, userMessage("just a normal request"))
    const params: any = { options: {} }
    await hooks["chat.params"]({ sessionID: "x", model: { providerID: "anthropic", id: "claude-opus" } }, params)
    expect(params.options.thinking).toBeUndefined()
  })
})

describe("plugin: session cleanup", () => {
  it("deletes the classifier's throwaway session with { path: { id } } after a classification", async () => {
    const { hooks, calls } = await makePlugin(ENABLED)
    await hooks["tool.execute.before"]({ tool: "bash", sessionID: "x", callID: "c1" }, { args: { command: "git push origin dev" } })
    const del = calls.find((c) => c[0] === "delete") // fresh-per-call: deleted in runTurn's finally
    expect(del).toBeTruthy()
    expect((del![1] as any).path.id).toMatch(/^s\d+$/)
  })

  it("prunes per-session state on session.deleted", async () => {
    const { hooks } = await makePlugin(ENABLED)
    await hooks["tool.execute.before"]({ tool: "bash", sessionID: "gone", callID: "c1" }, { args: { command: "npm test" } })
    await hooks.event({ event: { type: "session.deleted", properties: { info: { id: "gone" } } } })
    // After pruning, a cached verdict for the old callID is gone.
    const out = { status: "ask" as const }
    await hooks["permission.ask"]({ sessionID: "gone", callID: "c1" }, out)
    expect(out.status).toBe("ask")
  })
})
