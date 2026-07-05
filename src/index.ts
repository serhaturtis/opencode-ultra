/**
 * opencode-ultra — Auto mode + ultracode dynamic workflows.
 * Plugin entry point. Registers all hooks and tools with opencode.
 */
import type { Plugin } from "@opencode-ai/plugin"
import { createState } from "./state.js"
import { compileConfig } from "./config.js"
import { type CompiledConfig, type RawOpenCodeUltraConfig, type SessionState } from "./contracts.js"
import { type ISdkClient } from "./sdk-client.js"
import { createRealSdkClient } from "./sdk-real.js"
import { ClassifierSession } from "./auto-mode/stage2.js"
import { WorktreeManager } from "./ultracode/worktree.js"
import { createWorkflowTool } from "./ultracode/workflow-tool.js"
import { createWorkflowManagerTool } from "./ultracode/workflow-manager.js"
import { LogMetrics } from "./metrics.js"
import type { HookInput, HookOutput } from "./hooks/types.js"
import type { PluginContext } from "./hooks/context.js"

import { onToolBefore, onToolAfter, onPermissionAsk } from "./hooks/auto-handlers.js"
import { onChatMessage, onSystemTransform, onChatParams } from "./hooks/chat-handlers.js"
import { onCommand } from "./hooks/command-handlers.js"
import { onEvent, onCompacting, onDispose } from "./hooks/event-handlers.js"

export default (async function opencodeUltra(input, options) {
  const { client, directory } = input
  const sdk: ISdkClient = createRealSdkClient(client)

  const raw = (options && typeof options === "object" ? options : {}) as Record<string, unknown>
  const config: CompiledConfig = compileConfig(raw as unknown as RawOpenCodeUltraConfig)
  for (const w of config.warnings) sdk.log("warn", w)

  const worktrees = new WorktreeManager(directory)
  const state = createState(() => config, worktrees)
  const classifier = new ClassifierSession(sdk)
  const metrics = new LogMetrics(sdk)

  if (config.autoMode.enabled) void classifier.verifyAgent(config.autoMode)

  const ctx: PluginContext = { sdk, state, config, directory, worktrees, classifier, metrics }

  return {
    tool: {
      workflow: createWorkflowTool(sdk, state, () => config, directory, worktrees),
      "workflow-manager": createWorkflowManagerTool(state),
    },

    async "tool.execute.before"(i: HookInput<"tool.execute.before">, o: HookOutput<"tool.execute.before">) {
      return onToolBefore(ctx, i, o)
    },
    async "tool.execute.after"(i: HookInput<"tool.execute.after">, o: HookOutput<"tool.execute.after">) {
      return onToolAfter(ctx, i, o)
    },
    async "permission.ask"(i: HookInput<"permission.ask">, o: HookOutput<"permission.ask">) {
      return onPermissionAsk(ctx, i, o)
    },
    async "chat.message"(i: HookInput<"chat.message">, o: HookOutput<"chat.message">) {
      return onChatMessage(ctx, i, o)
    },
    async "experimental.chat.system.transform"(i: HookInput<"experimental.chat.system.transform">, o: HookOutput<"experimental.chat.system.transform">) {
      return onSystemTransform(ctx, i, o)
    },
    async "chat.params"(i: HookInput<"chat.params">, o: HookOutput<"chat.params">) {
      return onChatParams(ctx, i, o)
    },
    async "command.execute.before"(i: HookInput<"command.execute.before">, o: HookOutput<"command.execute.before">) {
      return onCommand(ctx, i, o)
    },
    async event(i: HookInput<"event">) {
      return onEvent(ctx, i)
    },
    async "experimental.session.compacting"(i: HookInput<"experimental.session.compacting">, o: HookOutput<"experimental.session.compacting">) {
      onCompacting(ctx, i, o)
    },
    async dispose() {
      await onDispose(ctx)
    },
  }
}) satisfies Plugin
