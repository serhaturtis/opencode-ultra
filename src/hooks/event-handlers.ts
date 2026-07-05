import type { HookInput, HookOutput } from "./types.js"
import type { PluginContext } from "./context.js"
import { recordApproval, onCompaction } from "../auto-mode/fallback.js"

export async function onEvent(ctx: PluginContext, input: HookInput<"event">): Promise<void> {
  const e = input.event
  switch (e.type) {
    case "permission.replied": {
      const { sessionID, response } = e.properties
      const auto = ctx.state.sessions.peek(sessionID)?.autoMode
      if (auto && auto.active && auto.paused && response !== "reject") {
        recordApproval(auto)
      }
      return
    }
    case "session.deleted": {
      ctx.state.workflows.stopForSession(e.properties.info.id)
      ctx.state.sessions.remove(e.properties.info.id)
      return
    }
    case "session.error": {
      // Safety: a session-level error (provider auth, aborted, etc.) deactivates
      // auto-mode for that session so it doesn't keep running in a broken context.
      if (e.properties.sessionID) {
        const auto = ctx.state.sessions.peek(e.properties.sessionID)?.autoMode
        if (auto?.active) {
          auto.paused = true
          ctx.sdk.log("warn", `auto-mode: session ${e.properties.sessionID} errored — auto mode paused`)
        }
      }
      return
    }
    case "session.compacted": {
      // Structured observability: verify a compacted session's boundaries survived
      // (they're pushed into the compaction context by onCompacting, so this is
      // an opportunity to log if they did NOT survive).
      if (e.properties.sessionID) {
        const ses = ctx.state.sessions.peek(e.properties.sessionID)
        ctx.sdk.log("info", JSON.stringify({
          event: "session.compacted",
          sessionID: e.properties.sessionID,
          autoActive: ses?.autoMode.active,
          boundaries: ses?.autoMode.boundaries.length ?? 0,
        }))
      }
      return
    }
    case "installation.updated": {
      ctx.sdk.log("info", `opencode-ultra: installation updated to version ${e.properties.version} — a restart may be needed for plugin changes to take effect`)
      return
    }
  }
}

export function onCompacting(
  ctx: PluginContext,
  input: HookInput<"experimental.session.compacting">,
  output: HookOutput<"experimental.session.compacting">,
): void {
  const auto = ctx.state.sessions.peek(input.sessionID)?.autoMode
  if (!auto?.active) return
  for (const b of auto.boundaries) {
    output.context.push(`Standing instruction (user constraint): ${b}`)
  }
  onCompaction(auto)
}

export async function onDispose(ctx: PluginContext): Promise<void> {
  await ctx.state.workflows.shutdown((m) => ctx.sdk.log("warn", m))
}
