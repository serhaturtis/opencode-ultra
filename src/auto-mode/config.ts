/**
 * Auto-mode config compilation. Owns defaults, resolution, rule validation,
 * pattern compilation, and reminder rendering. Core config.ts composes this —
 * never embeds auto-mode logic directly.
 */
import {
  type AutoModeConfig,
  type ModelId,
  type CompiledAutoModeConfig,
  type RawAutoModeConfig,
} from "../contracts.js"
import { DEFAULTS } from "./defaults.js"
import { compileRules } from "./rule-compiler.js"
import { buildReminder } from "./system-reminder.js"
import { deepFreeze } from "../freeze.js"

const DEFAULT_CACHE_TTL_MS = 300_000

export const DEFAULT_AUTO_MODE_CONFIG: AutoModeConfig = deepFreeze({
  enabled: false,
  defaultMode: false,
  environment: [...DEFAULTS.environment],
  allow: [...DEFAULTS.allow],
  softDeny: [...DEFAULTS.softDeny],
  hardDeny: [...DEFAULTS.hardDeny],
  maxConsecutiveDenials: 3,
  maxTotalDenials: 20,
  classifier: { agent: "general", cacheTtlMs: DEFAULT_CACHE_TTL_MS },
})

/** Compile raw auto-mode config; `warnings` accumulates non-fatal issues. */
export function compileAutoModeConfig(raw: RawAutoModeConfig, warnings: string[]): CompiledAutoModeConfig {
  const resolved = resolveAutoMode(raw, warnings)
  warnings.push(...validateRules(resolved))
  const rules = compileRules(resolved)
  return deepFreeze({
    enabled: resolved.enabled,
    defaultMode: resolved.defaultMode,
    stage1Rules: rules.stage1Rules,
    stage2PromptText: rules.stage2PromptText,
    systemReminderText: buildReminder(resolved),
    maxConsecutiveDenials: resolved.maxConsecutiveDenials,
    maxTotalDenials: resolved.maxTotalDenials,
    classifier: resolved.classifier,
  })
}

/** Boot config for auto-mode — everything off, using real defaults. */
export function disabledAutoModeConfig(): CompiledAutoModeConfig {
  const d = DEFAULT_AUTO_MODE_CONFIG
  return deepFreeze({
    enabled: false,
    defaultMode: false,
    stage1Rules: [],
    stage2PromptText: "",
    systemReminderText: buildReminder(d),
    maxConsecutiveDenials: d.maxConsecutiveDenials,
    maxTotalDenials: d.maxTotalDenials,
    classifier: d.classifier,
  })
}

// ── Resolution ───────────────────────────────────────────────────────────────

function resolveAutoMode(raw: RawAutoModeConfig, warnings: string[]): AutoModeConfig {
  const d = DEFAULT_AUTO_MODE_CONFIG
  return deepFreeze({
    enabled: raw.enabled ?? d.enabled,
    defaultMode: raw.defaultMode ?? d.defaultMode,
    environment: resolveDefaults(raw.environment, d.environment),
    allow: resolveDefaults(raw.allow, d.allow),
    softDeny: resolveDefaults(raw.softDeny, d.softDeny),
    hardDeny: resolveDefaults(raw.hardDeny, d.hardDeny),
    maxConsecutiveDenials: raw.maxConsecutiveDenials ?? d.maxConsecutiveDenials,
    maxTotalDenials: raw.maxTotalDenials ?? d.maxTotalDenials,
    classifier: deepFreeze({
      model: parseClassifierModel(raw.classifier?.model, warnings),
      agent: raw.classifier?.agent ?? d.classifier.agent,
      cacheTtlMs: raw.classifier?.cacheTtlMs ?? d.classifier.cacheTtlMs,
    }),
  })
}

/** Parse a "providerID/modelID" string; an invalid value warns and uses the agent default. */
function parseClassifierModel(raw: string | undefined, warnings: string[]): ModelId | undefined {
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

/** `$defaults` marker → prepend builtins before user rules; otherwise user rules replace builtins. */
function resolveDefaults(user: readonly string[] | undefined, builtins: readonly string[]): readonly string[] {
  if (!user || user.length === 0) return builtins
  if (!user.includes("$defaults")) return [...user]
  return [...builtins, ...user.filter((r) => r !== "$defaults")]
}

// ── Rule validation ──────────────────────────────────────────────────────────

function validateRules(config: AutoModeConfig): string[] {
  const warnings: string[] = []
  for (const [label, rules] of [["hard_deny", config.hardDeny], ["soft_deny", config.softDeny]] as const) {
    const builtins: readonly string[] = label === "hard_deny" ? DEFAULTS.hardDeny : DEFAULTS.softDeny
    for (const rule of rules) {
      // Skip built-in defaults — they are pre-vetted.
      if (builtins.includes(rule)) continue
      if (isVague(rule)) {
        warnings.push(
          `autoMode.${label} rule "${rule}" is too vague to enforce concretely. ` +
          `Consider: "Never delete production data" or "Never modify .env files."`,
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
  return !concretePatterns.some((p) => p.test(rule))
}
