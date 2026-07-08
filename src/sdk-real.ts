/**
 * RealSdkClient — production adapter wrapping the opencode OpencodeClient.
 *
 * Handles SDK response unwrapping and parameter format translation.
 * This is the ONLY module that imports from @opencode-ai/sdk.
 * When the SDK changes, only this file needs updating.
 *
 * Call shapes verified against @opencode-ai/sdk dist/gen/{sdk.gen,types.gen}.d.ts:
 *   - session.create({ body: { parentID?, title? } })           -> { data: { id, ... } }
 *   - session.prompt({ path: { id }, body: {...} })             -> { data: { info, parts } }
 *   - session.delete({ path: { id } })                          -> path-based, NOT { sessionID }
 */
import type { OpencodeClient } from "@opencode-ai/sdk"
import type { ISdkClient } from "./sdk-client.js"
import { errMsg } from "./util.js"

export function createRealSdkClient(client: OpencodeClient): ISdkClient {
  // Boundary cast: the SDK's OpencodeClient type has methods that exist at
  // runtime but are not reflected in the TypeScript types. The any-cast is
  // the single point of adaptation — all further access goes through ISdkClient.
  const c = client as any

  return {
    log(level, message) {
      // Route to the opencode server log — NEVER console.* (that corrupts the TUI).
      // Fire-and-forget and fully guarded: logging must never throw or block a hook.
      try {
        const r = c.app?.log?.({ body: { service: "opencode-ultra", level, message } })
        if (r && typeof r.then === "function") r.then(undefined, () => {})
      } catch { /* swallow — diagnostics must never break the plugin */ }
    },

    async createSession(parentId, title, directory) {
      const res = await c.session.create({
        body: { parentID: parentId || undefined, title },
        ...(directory ? { query: { directory } } : {}),
      })
      // Defensive: hey-api clients return { data } with throwOnError:false,
      // but resolve to the payload directly when throwOnError:true.
      const id = res?.data?.id ?? res?.id
      // Fail fast: the contract is Promise<string>. A malformed response must not
      // silently propagate `undefined` into callers that use it as a session id.
      if (typeof id !== "string" || id === "") {
        throw new Error("session.create returned no session id (malformed SDK response)")
      }
      return id
    },

    async promptSession(sessionId, options) {
      const res = await c.session.prompt({
        path: { id: sessionId },
        body: {
          ...(options.agent ? { agent: options.agent } : {}),
          ...(options.system ? { system: options.system } : {}),
          ...(options.model ? { model: options.model } : {}),
          ...(options.tools ? { tools: options.tools } : {}),
          ...(options.noReply ? { noReply: options.noReply } : {}),
          parts: options.parts,
        },
      })
      // Response 200 = { info: AssistantMessage; parts: Part[] }. Parts are a
      // sibling of info; usage lives on info (cost + tokens).
      const info = res?.data?.info ?? res?.info
      const parts = res?.data?.parts ?? res?.parts ?? []
      const text = parts.find((p: { type: string; text?: string }) => p.type === "text")?.text ?? ""
      if (!text) throw new Error("session.prompt returned no text part (malformed SDK response)")
      const t = info?.tokens
      const tokens = t ? (t.input ?? 0) + (t.output ?? 0) + (t.reasoning ?? 0) : 0
      return { text, cost: info?.cost ?? 0, tokens }
    },

    async deleteSession(sessionId) {
      try {
        await c.session.delete({ path: { id: sessionId } })
      } catch (err) {
        // Session deletion failure is surfaced to the server log so it's not
        // invisibly leaked — but it must never throw, because callers don't
        // expect a throw and a failed delete is a resource leak, not a workflow
        // correctness failure.
        const msg = errMsg(err)
        try { c.app?.log?.({ body: { service: "opencode-ultra", level: "warn", message: `session deletion failed for ${sessionId}: ${msg}` } }) } catch {}
      }
    },

    async listAgents() {
      const res = await c.app.agents()
      const agents = (res?.data ?? res ?? []) as Array<{ name?: string }>
      return agents.map((a) => a.name).filter((n): n is string => typeof n === "string")
    },
  }
}
