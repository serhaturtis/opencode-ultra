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

export function createRealSdkClient(client: OpencodeClient): ISdkClient {
  const c = client as any

  return {
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
      const t = info?.tokens
      const tokens = t ? (t.input ?? 0) + (t.output ?? 0) + (t.reasoning ?? 0) : 0
      return { text, cost: info?.cost ?? 0, tokens }
    },

    async deleteSession(sessionId) {
      await c.session.delete({ path: { id: sessionId } }).catch(() => {})
    },

    async listAgents() {
      const res = await c.app.agents()
      const agents = (res?.data ?? res ?? []) as Array<{ name?: string }>
      return agents.map((a) => a.name).filter((n): n is string => typeof n === "string")
    },
  }
}
