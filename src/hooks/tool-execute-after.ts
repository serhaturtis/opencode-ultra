/**
 * tool.execute.after — scoped prompt-injection probe.
 * Only untrusted output is examined; cheap regex pre-filter → classifier confirm → banner.
 */
import { type CompiledConfig } from "../contracts.js"
import { ClassifierSession } from "../auto-mode/stage2.js"
import { INJECTION_WARNING, isUntrustedSource, looksLikeInjection } from "../auto-mode/probe.js"

export interface ToolAfterInput {
  readonly tool: string
  readonly args: unknown
}

export interface ToolAfterOutput {
  output: string
  metadata?: Record<string, unknown>
}

export interface ProbeDeps {
  readonly projectDir: string
  readonly classifier: ClassifierSession
  readonly config: CompiledConfig
}

export async function handleToolExecuteAfter(
  input: ToolAfterInput,
  output: ToolAfterOutput,
  deps: ProbeDeps,
): Promise<void> {
  if (!isUntrustedSource(input.tool, input.args, deps.projectDir)) return
  if (!looksLikeInjection(output.output)) return
  if (!(await deps.classifier.detectInjection(output.output, deps.config.autoMode))) return

  output.output = INJECTION_WARNING + output.output
  if (output.metadata) output.metadata.injectionDetected = true
}
