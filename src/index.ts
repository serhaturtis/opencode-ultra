/**
 * opencode-ultra — Auto mode + ultracode dynamic workflows.
 *
 * Plugin entry point. Registers all hooks and tools with opencode.
 * Zero core patches required — everything works through the plugin API.
 *
 * Architecture:
 *   - contracts.ts: Pure type definitions, zero runtime deps
 *   - errors.ts: Typed error classes per failure domain
 *   - state.ts: Per-session state store + global workflow registry
 *   - config.ts: Config compilation, single source of truth for defaults
 *   - auto-mode/: Stage 1 (heuristic + compiled rules), Stage 2 (classifier),
 *                 verdict cache, boundaries, probe
 *   - ultracode/: Parser, engine, pool, templates, summarizer, tools
 *   - hooks/: Adapters between opencode plugin API and our engine
 *
 * Auto-mode and ultracode state are per-session (keyed by sessionID); the
 * classifier and workflow registry are shared services.
 */
import type { Plugin } from "@opencode-ai/plugin"
import { createState } from "./state.js"
import { compileConfig } from "./config.js"
import { type CompiledConfig, type SessionState } from "./contracts.js"
import { type ISdkClient } from "./sdk-client.js"
import { createRealSdkClient } from "./sdk-real.js"
import { ClassifierSession } from "./auto-mode/stage2.js"
import { activate, deactivate, onCompaction, recordApproval } from "./auto-mode/fallback.js"
import { captureBoundaries } from "./auto-mode/boundaries.js"
import { buildPausedReminder } from "./auto-mode/system-reminder.js"
import { createWorkflowTool } from "./ultracode/workflow-tool.js"
import { createWorkflowManagerTool, formatWorkflowList } from "./ultracode/workflow-manager.js"
import { buildUltracodeReminder } from "./ultracode/system-reminder.js"
import { textFromParts, isUltracodeKeyword } from "./ultracode/keyword.js"
import { handleToolExecuteBefore } from "./hooks/tool-execute-before.js"
import { handleToolExecuteAfter } from "./hooks/tool-execute-after.js"
import { handlePermissionAsk } from "./hooks/permission-handler.js"
import { setMaxThinkingEffort } from "./hooks/chat-params.js"

// ── Plugin Entry ─────────────────────────────────────────────────────────────

export default (async function opencodeUltra(input, options) {
  const { client, directory } = input

  const sdk: ISdkClient = createRealSdkClient(client)

  // Settings arrive as this plugin entry's options in opencode.json:
  //   "plugin": [["/abs/dist/index.js", { "autoMode": {...}, "ultracode": {...} }]]
  // opencode's config schema sets additionalProperties:false at the root, so
  // settings cannot live as top-level config keys — they ride the plugin tuple
  // and are delivered here as the second argument.
  const raw = (options && typeof options === "object" ? options : {}) as Record<string, unknown>
  const config: CompiledConfig = compileConfig({ autoMode: raw.autoMode as any, ultracode: raw.ultracode as any })
  for (const w of config.warnings) console.warn(`[opencode-ultra] ${w}`)

  const state = createState(() => config)
  const classifier = new ClassifierSession(sdk)

  // When auto mode can run, verify the classifier agent exists (once, best-effort).
  if (config.autoMode.enabled) void classifier.verifyAgent(config.autoMode)

  return {
    tool: {
      workflow: createWorkflowTool(sdk, state, () => config, directory),
      "workflow-manager": createWorkflowManagerTool(state),
    },

    async "tool.execute.before"(hookInput, output) {
      const auto = state.sessions.get(hookInput.sessionID).autoMode
      if (!auto.active || auto.paused) return
      await handleToolExecuteBefore(
        { tool: hookInput.tool, sessionID: hookInput.sessionID, callID: hookInput.callID },
        { args: output.args },
        config,
        auto,
        classifier,
      )
    },

    async "tool.execute.after"(hookInput, output) {
      const auto = state.sessions.get(hookInput.sessionID).autoMode
      if (!auto.active) return
      await handleToolExecuteAfter(
        { tool: hookInput.tool, args: (hookInput as { args?: unknown }).args },
        output as unknown as { output: string; metadata?: Record<string, unknown> },
        { projectDir: directory, classifier, config },
      )
    },

    // The dedicated permission hook: enforce the verdict cached by callID.
    async "permission.ask"(hookInput, output) {
      const auto = state.sessions.peek((hookInput as { sessionID?: string }).sessionID ?? "")?.autoMode
      if (!auto || !auto.active || auto.paused) return
      handlePermissionAsk(hookInput as { callID?: string }, output, auto)
    },

    // Per-session user-message capture: latest message, boundaries, keyword.
    // (chat.message carries sessionID and fires once per user turn — unlike
    // messages.transform, whose input has no sessionID.)
    async "chat.message"(hookInput, output) {
      const session = state.sessions.get(hookInput.sessionID)
      const text = textFromParts((output as { parts?: Array<{ type?: string; text?: string }> }).parts)
      session.autoMode.lastUserMessage = text
      session.autoMode.verdicts.clear() // new user turn — intent may have shifted
      captureBoundaries(session.autoMode.boundaries, text)
      session.ultracode.singleTurn = config.ultracode.keywordTrigger && isUltracodeKeyword(text)
    },

    async "experimental.chat.system.transform"(hookInput, output) {
      const sessionID = (hookInput as { sessionID?: string }).sessionID
      if (!sessionID) return
      const session = state.sessions.get(sessionID)
      const reminders: string[] = []

      if (session.autoMode.active) {
        reminders.push(session.autoMode.paused ? buildPausedReminder() : config.autoMode.systemReminderText)
      }
      if (session.ultracode.active || session.ultracode.singleTurn) {
        reminders.push(buildUltracodeReminder())
      }
      if (reminders.length > 0) output.system.push(reminders.join("\n"))
    },

    async "chat.params"(hookInput, output) {
      const session = state.sessions.get((hookInput as { sessionID: string }).sessionID)
      if (!session.ultracode.active && !session.ultracode.singleTurn) return
      const model = (hookInput as { model?: { providerID?: string; id?: string } }).model
      setMaxThinkingEffort(
        { providerID: model?.providerID, id: model?.id ?? "" },
        output as { options: Record<string, unknown> },
      )
    },

    // `/auto`, `/ultracode`, `/workflows` — real handlers, not just prompt text.
    async "command.execute.before"(hookInput, output) {
      const cmd = (hookInput as { command?: string }).command
      const sessionID = (hookInput as { sessionID: string }).sessionID
      const arg = ((hookInput as { arguments?: string }).arguments ?? "").trim().toLowerCase()
      let message: string | undefined
      if (cmd === "auto") message = await handleAutoCommand(sessionID, arg)
      else if (cmd === "ultracode") message = handleUltracodeCommand(sessionID, arg)
      else if (cmd === "workflows") message = formatWorkflowList(state)
      if (message === undefined) return
      // Replace the rendered command template with our handler's output. Mutate
      // the array IN PLACE — opencode reads a captured reference, so reassigning
      // output.parts would be invisible to it.
      const parts = (output as { parts: Array<{ type: string; text: string }> }).parts
      parts.length = 0
      parts.push({ type: "text", text: message })
    },

    async event({ event }) {
      const e = event as { type?: string; properties?: Record<string, unknown> }
      if (e.type === "permission.replied") {
        // User manually answered a prompt while paused → resume on approval.
        const props = e.properties as { sessionID?: string; response?: string } | undefined
        const auto = props?.sessionID ? state.sessions.peek(props.sessionID)?.autoMode : undefined
        if (auto && auto.active && auto.paused && props?.response && props.response !== "reject") {
          recordApproval(auto)
        }
      } else if (e.type === "session.deleted") {
        // Reclaim per-session state.
        const info = (e.properties as { info?: { id?: string } } | undefined)?.info
        if (info?.id) state.sessions.remove(info.id)
      }
    },

    async "experimental.session.compacting"(hookInput) {
      const auto = state.sessions.peek((hookInput as { sessionID: string }).sessionID)?.autoMode
      if (auto?.active) onCompaction(auto)
    },

    async dispose() {
      state.workflows.shutdown()
    },
  }

  // ── /auto command ──────────────────────────────────────────────────────────

  async function handleAutoCommand(sessionID: string, arg: string): Promise<string> {
    if (!config.autoMode.enabled) {
      return "Auto mode is disabled by configuration (autoMode.enabled = false). Ask an admin to enable it."
    }
    const session: SessionState = state.sessions.get(sessionID)
    const auto = session.autoMode

    switch (arg) {
      case "":
      case "on":
        activate(auto)
        void classifier.verifyAgent(config.autoMode)
        return "Auto mode ENABLED for this session. Routine operations proceed without asking; risky actions are classified before execution."
      case "off":
        deactivate(auto)
        return "Auto mode DISABLED for this session. The normal permission prompts are back."
      case "status":
        return [
          `Auto mode: ${auto.active ? (auto.paused ? "PAUSED" : "ACTIVE") : "off"}`,
          `Consecutive denials: ${auto.consecutiveDenials} / ${config.autoMode.maxConsecutiveDenials}`,
          `Total denials: ${auto.totalDenials} / ${config.autoMode.maxTotalDenials}`,
          auto.boundaries.length ? `Standing instructions: ${auto.boundaries.length}` : "Standing instructions: none",
        ].join("\n")
      case "defaults":
      case "config":
        return config.autoMode.systemReminderText
      default:
        return `Unknown /auto argument '${arg}'. Use: on | off | status | defaults | config.`
    }
  }

  // ── /ultracode command ───────────────────────────────────────────────────

  function handleUltracodeCommand(sessionID: string, arg: string): string {
    const ultracode = state.sessions.get(sessionID).ultracode
    switch (arg) {
      case "":
      case "on":
        ultracode.active = true
        return "Ultracode mode ENABLED for this session. The model will proactively orchestrate multi-agent workflows and use maximum reasoning effort."
      case "off":
        ultracode.active = false
        return "Ultracode mode DISABLED for this session."
      case "status":
        return `Ultracode mode: ${ultracode.active ? "ACTIVE" : "off"} (keyword trigger: ${config.ultracode.keywordTrigger ? "on" : "off"})`
      default:
        return `Unknown /ultracode argument '${arg}'. Use: on | off | status.`
    }
  }
}) satisfies Plugin
