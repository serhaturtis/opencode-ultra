/**
 * Config compiler — transforms raw user config from opencode.json into
 * the immutable compiled configuration used by all other modules.
 *
 * Single source of truth for defaults. No other module defines default values.
 */
import {
  type AutoModeConfig,
  type ClassifierModel,
  type CompiledConfig,
  type UltracodeConfig,
  type RawAutoModeConfig,
  type RawOpenCodeUltraConfig,
  type RawUltracodeConfig,
} from "./contracts.js"
import { DEFAULTS } from "./auto-mode/defaults.js"
import { compileRules } from "./auto-mode/rule-compiler.js"
import { buildReminder } from "./auto-mode/system-reminder.js"

// ── Constants ────────────────────────────────────────────────────────────────

/** Default verdict-cache TTL: long enough to cut repeated re-classification, short enough to track shifting intent. */
const DEFAULT_CACHE_TTL_MS = 300_000

export const DEFAULT_AUTO_MODE_CONFIG: AutoModeConfig = Object.freeze({
  enabled: false,
  defaultMode: false,
  environment: Object.freeze([...DEFAULTS.environment]),
  allow: Object.freeze([...DEFAULTS.allow]),
  softDeny: Object.freeze([...DEFAULTS.softDeny]),
  hardDeny: Object.freeze([...DEFAULTS.hardDeny]),
  maxConsecutiveDenials: 3,
  maxTotalDenials: 20,
  classifier: Object.freeze({ agent: "general", cacheTtlMs: DEFAULT_CACHE_TTL_MS }),
})

export const DEFAULT_ULTRACODE_CONFIG: UltracodeConfig = Object.freeze({
  enabled: false,
  keywordTrigger: true,
  workflowRuntime: Object.freeze({
    maxConcurrent: 16,
    maxTotalAgents: 1000,
    maxConcurrentWorkflows: 3,
    agentTimeout: 600_000,
    workflowTimeout: 3_600_000,
    maxCostUsd: 0, // 0 = unlimited
    agentRetries: 1,
  }),
  summarization: Object.freeze({
    agentResultMaxChars: 2000,
    deduplicate: true,
  }),
  journalDir: ".opencode-ultra/journal",
})

/** The config used before the config hook fires. Everything disabled. */
export const DEFAULT_DISABLED_CONFIG: CompiledConfig = Object.freeze({
  autoMode: Object.freeze({
    enabled: false,
    defaultMode: false,
    stage1Rules: Object.freeze([]),
    stage2PromptText: "",
    systemReminderText: buildReminder(DEFAULT_AUTO_MODE_CONFIG),
    maxConsecutiveDenials: 3,
    maxTotalDenials: 20,
    classifier: DEFAULT_AUTO_MODE_CONFIG.classifier,
  }),
  ultracode: DEFAULT_ULTRACODE_CONFIG,
  warnings: Object.freeze([]),
})

// ── Compiled Config ──────────────────────────────────────────────────────────

/**
 * Compile raw user config from opencode.json into the immutable
 * CompiledConfig used throughout the plugin.
 */
export function compileConfig(raw: RawOpenCodeUltraConfig): CompiledConfig {
  const warnings: string[] = []
  const autoModeConfig = compileAutoMode(raw.autoMode ?? {}, warnings)
  const ultracodeConfig = compileUltracode(raw.ultracode ?? {})
  warnings.push(...validateRules(autoModeConfig))
  const rules = compileRules(autoModeConfig)

  return Object.freeze({
    autoMode: Object.freeze({
      enabled: autoModeConfig.enabled,
      defaultMode: autoModeConfig.defaultMode,
      stage1Rules: rules.stage1Rules,
      stage2PromptText: rules.stage2PromptText,
      systemReminderText: buildReminder(autoModeConfig),
      maxConsecutiveDenials: autoModeConfig.maxConsecutiveDenials,
      maxTotalDenials: autoModeConfig.maxTotalDenials,
      classifier: autoModeConfig.classifier,
    }),
    ultracode: ultracodeConfig,
    warnings: Object.freeze(warnings),
  })
}

// ── Auto Mode Compilation ────────────────────────────────────────────────────

function compileAutoMode(raw: RawAutoModeConfig, warnings: string[]): AutoModeConfig {
  const defaults = DEFAULT_AUTO_MODE_CONFIG

  return Object.freeze({
    enabled: raw.enabled ?? defaults.enabled,
    defaultMode: raw.defaultMode ?? defaults.defaultMode,
    environment: Object.freeze(resolveDefaults(raw.environment, defaults.environment)),
    allow: Object.freeze(resolveDefaults(raw.allow, defaults.allow)),
    softDeny: Object.freeze(resolveDefaults(raw.softDeny, defaults.softDeny)),
    hardDeny: Object.freeze(resolveDefaults(raw.hardDeny, defaults.hardDeny)),
    maxConsecutiveDenials: raw.maxConsecutiveDenials ?? defaults.maxConsecutiveDenials,
    maxTotalDenials: raw.maxTotalDenials ?? defaults.maxTotalDenials,
    classifier: Object.freeze({
      model: parseClassifierModel(raw.classifier?.model, warnings),
      agent: raw.classifier?.agent ?? defaults.classifier.agent,
      cacheTtlMs: raw.classifier?.cacheTtlMs ?? defaults.classifier.cacheTtlMs,
    }),
  })
}

/** Parse a "providerID/modelID" string; an invalid value warns and uses the agent default. */
function parseClassifierModel(raw: string | undefined, warnings: string[]): ClassifierModel | undefined {
  if (raw === undefined) return undefined
  const slash = raw.indexOf("/")
  if (slash <= 0 || slash >= raw.length - 1) {
    warnings.push(
      `autoMode.classifier.model "${raw}" must be "providerID/modelID"; using the classifier agent's model instead.`,
    )
    return undefined
  }
  return Object.freeze({ providerID: raw.slice(0, slash), modelID: raw.slice(slash + 1) })
}

function resolveDefaults(user: readonly string[] | undefined, builtins: readonly string[]): readonly string[] {
  if (!user || user.length === 0) return builtins
  const hasDollar = user.includes("$defaults")
  if (!hasDollar) return Object.freeze([...user])
  // $defaults marker → prepend builtins before user rules
  return Object.freeze([...builtins, ...user.filter(r => r !== "$defaults")])
}

// ── Ultracode Compilation ────────────────────────────────────────────────────

function compileUltracode(raw: RawUltracodeConfig): UltracodeConfig {
  const defaults = DEFAULT_ULTRACODE_CONFIG

  return Object.freeze({
    enabled: raw.enabled ?? defaults.enabled,
    keywordTrigger: raw.keywordTrigger ?? defaults.keywordTrigger,
    workflowRuntime: Object.freeze({
      maxConcurrent: raw.workflowRuntime?.maxConcurrent ?? defaults.workflowRuntime.maxConcurrent,
      maxTotalAgents: raw.workflowRuntime?.maxTotalAgents ?? defaults.workflowRuntime.maxTotalAgents,
      maxConcurrentWorkflows: raw.workflowRuntime?.maxConcurrentWorkflows ?? defaults.workflowRuntime.maxConcurrentWorkflows,
      agentTimeout: raw.workflowRuntime?.agentTimeout ?? defaults.workflowRuntime.agentTimeout,
      workflowTimeout: raw.workflowRuntime?.workflowTimeout ?? defaults.workflowRuntime.workflowTimeout,
      maxCostUsd: raw.workflowRuntime?.maxCostUsd ?? defaults.workflowRuntime.maxCostUsd,
      agentRetries: raw.workflowRuntime?.agentRetries ?? defaults.workflowRuntime.agentRetries,
    }),
    summarization: Object.freeze({
      agentResultMaxChars: raw.summarization?.agentResultMaxChars ?? defaults.summarization.agentResultMaxChars,
      deduplicate: raw.summarization?.deduplicate ?? defaults.summarization.deduplicate,
    }),
    journalDir: raw.journalDir ?? defaults.journalDir,
  })
}

// ── Rule Validation ──────────────────────────────────────────────────────────

function validateRules(config: AutoModeConfig): string[] {
  const warnings: string[] = []

  for (const [label, rules] of [["hard_deny", config.hardDeny], ["soft_deny", config.softDeny]] as const) {
    const builtins: readonly string[] = label === "hard_deny" ? DEFAULTS.hardDeny : DEFAULTS.softDeny

    for (const rule of rules) {
      // Skip built-in defaults — they are pre-vetted
      if (builtins.includes(rule)) continue
      if (isVague(rule)) {
        warnings.push(
          `autoMode.${label} rule "${rule}" is too vague to enforce concretely. ` +
          `Consider: "Never delete production data" or "Never modify .env files."`
        )
      }
    }
  }

  return warnings
}

function isVague(rule: string): boolean {
  const concretePatterns = [
    /\b(push|deploy|delete|modify|install|execute|send|run|write)\b/i,
    /\b(main|master|production|staging|\.env|node_modules|\.git)\b/i,
    /\b(database|migration|api|endpoint|server|bucket|instance|role|group)\b/i,
    /\b(branch|file|directory|package|dependency|credential|token|secret)\b/i,
  ]
  const hasConcrete = concretePatterns.some(p => p.test(rule))
  return !hasConcrete
}
