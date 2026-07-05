/**
 * Ultracode configuration compilation — the single owner of ultracode defaults
 * and the translation from raw user config into the immutable UltracodeConfig.
 *
 * Symmetric with auto-mode/config.ts: each subsystem owns its own defaults and
 * compilation; the core config module composes both.
 */
import { type RawUltracodeConfig, type UltracodeConfig } from "../contracts.js"
import { deepFreeze } from "../freeze.js"

/** The single source of truth for ultracode defaults. Deep-frozen; never mutated. */
export const DEFAULT_ULTRACODE_CONFIG: UltracodeConfig = deepFreeze({
  enabled: false,
  keywordTrigger: true,
  workflowRuntime: {
    maxConcurrent: 16,
    maxTotalAgents: 1000,
    maxConcurrentWorkflows: 3,
    agentTimeout: 600_000,
    workflowTimeout: 3_600_000,
    maxCostUsd: 0, // 0 = unlimited
    agentCostCapUsd: 0, // 0 = spent-only enforcement (no start-time reservation)
    agentRetries: 1,
    maxJournalFiles: 100,
  },
  summarization: {
    agentResultMaxChars: 2000,
    deduplicate: true,
  },
  journalDir: ".opencode-ultra/journal",
})

/** Compile raw ultracode config from opencode.json into the immutable UltracodeConfig. */
export function compileUltracodeConfig(raw: RawUltracodeConfig): UltracodeConfig {
  const d = DEFAULT_ULTRACODE_CONFIG
  return deepFreeze({
    enabled: raw.enabled ?? d.enabled,
    keywordTrigger: raw.keywordTrigger ?? d.keywordTrigger,
    workflowRuntime: {
      maxConcurrent: raw.workflowRuntime?.maxConcurrent ?? d.workflowRuntime.maxConcurrent,
      maxTotalAgents: raw.workflowRuntime?.maxTotalAgents ?? d.workflowRuntime.maxTotalAgents,
      maxConcurrentWorkflows: raw.workflowRuntime?.maxConcurrentWorkflows ?? d.workflowRuntime.maxConcurrentWorkflows,
      agentTimeout: raw.workflowRuntime?.agentTimeout ?? d.workflowRuntime.agentTimeout,
      workflowTimeout: raw.workflowRuntime?.workflowTimeout ?? d.workflowRuntime.workflowTimeout,
      maxCostUsd: raw.workflowRuntime?.maxCostUsd ?? d.workflowRuntime.maxCostUsd,
      agentCostCapUsd: raw.workflowRuntime?.agentCostCapUsd ?? d.workflowRuntime.agentCostCapUsd,
      agentRetries: raw.workflowRuntime?.agentRetries ?? d.workflowRuntime.agentRetries,
      maxJournalFiles: raw.workflowRuntime?.maxJournalFiles ?? d.workflowRuntime.maxJournalFiles,
    },
    summarization: {
      agentResultMaxChars: raw.summarization?.agentResultMaxChars ?? d.summarization.agentResultMaxChars,
      deduplicate: raw.summarization?.deduplicate ?? d.summarization.deduplicate,
    },
    journalDir: raw.journalDir ?? d.journalDir,
  })
}
