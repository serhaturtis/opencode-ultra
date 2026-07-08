import type { ISdkClient } from "../sdk-client.js"
import type { Classifier, CompiledConfig, Metrics, UltraState, WorktreeReclaimer } from "../contracts.js"

export interface PluginContext {
  readonly sdk: ISdkClient
  readonly state: UltraState
  readonly config: CompiledConfig
  readonly directory: string
  readonly worktrees: WorktreeReclaimer
  readonly classifier: Classifier
  readonly metrics: Metrics
}
