import type { ISdkClient } from "../sdk-client.js"
import type { CompiledConfig, Metrics, UltraState, WorktreeReclaimer } from "../contracts.js"
import type { ClassifierSession } from "../auto-mode/stage2.js"

export interface PluginContext {
  readonly sdk: ISdkClient
  readonly state: UltraState
  readonly config: CompiledConfig
  readonly directory: string
  readonly worktrees: WorktreeReclaimer
  readonly classifier: ClassifierSession
  readonly metrics: Metrics
}
