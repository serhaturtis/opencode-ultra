/**
 * MockSdkClient — test double for ISdkClient.
 *
 * Returns predefined responses configured per test case. Tracks all calls for
 * assertion. promptSession returns an AgentRun ({ text, cost, tokens }); tests
 * override it to supply specific text/usage.
 */
import { type AgentRun, type ISdkClient } from "../../src/sdk-client"

export interface MockCall {
  method: string
  args: unknown[]
}

export function createMockSdk(): { sdk: ISdkClient; calls: MockCall[] } {
  const calls: MockCall[] = []

  const sdk: ISdkClient = {
    log(level, message) {
      calls.push({ method: "log", args: [level, message] })
    },

    async createSession(parentId, title, directory) {
      calls.push({ method: "createSession", args: [parentId, title, directory] })
      // Session ID is derived from the total call count — each session gets a unique
      // id across the test. Not session-count, which would require separate tracking.
      return `session-${calls.length}`
    },

    async promptSession(sessionId, options): Promise<AgentRun> {
      calls.push({ method: "promptSession", args: [sessionId, options] })
      return { text: "mock response text", cost: 0, tokens: 0 }
    },

    async deleteSession(sessionId) {
      calls.push({ method: "deleteSession", args: [sessionId] })
    },

    async listAgents() {
      calls.push({ method: "listAgents", args: [] })
      return ["build", "plan", "general", "explore", "title"]
    },
  }

  return { sdk, calls }
}
