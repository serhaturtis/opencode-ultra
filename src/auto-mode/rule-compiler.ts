/**
 * Translates configuration into enforcement rules:
 *  - Built-in DENY/ALLOW Stage 1 patterns
 *  - Prose rules compiled into Stage 1 patterns (deterministic, zero-latency)
 *  - All prose rendered into the Stage 2 classification prompt
 *
 * Hard rules emit DENY patterns; soft rules only escalate to FLAGGED.
 */
import { type AutoModeConfig, type Stage1Rule, type Stage1Verdict } from "../contracts.js"
import { DEFAULTS, STAGE1_RULES } from "./defaults.js"

export interface CompiledRules {
  readonly stage1Rules: readonly Stage1Rule[]
  readonly stage2PromptText: string
}

export function compileRules(config: AutoModeConfig): CompiledRules {
  return {
    stage1Rules: Object.freeze([
      ...STAGE1_RULES,
      ...compileProseToStage1(config.hardDeny, "hard"),
      ...compileProseToStage1(config.softDeny, "soft"),
    ]),
    stage2PromptText: compileStage2Prompt(config),
  }
}

// ── Prose → Stage 1 ──────────────────────────────────────────────────────────

type Severity = "hard" | "soft"

/** A compiler recognizes one class of prose rule and emits Stage 1 patterns. */
type ProseRuleCompiler = (prose: string, severity: Severity) => Stage1Rule[]

const PROSE_COMPILERS: readonly ProseRuleCompiler[] = Object.freeze([
  compileBranchPushRule,
  compileProtectedPathRule,
])

function compileProseToStage1(rules: readonly string[], severity: Severity): Stage1Rule[] {
  return rules.flatMap((prose) => PROSE_COMPILERS.flatMap((compile) => compile(prose, severity)))
}

/**
 * "never push to main", "don't force push to the release branch", … →
 *   force-push to a protected branch → DENY (hard) / FLAGGED (soft)
 *   normal push to a protected branch → FLAGGED
 *   a blanket "force push to any branch" rule → FLAGGED (Stage 2 decides per branch;
 *     deterministically blocking every force-push would break legitimate rebased
 *     feature-branch pushes).
 */
function compileBranchPushRule(prose: string, severity: Severity): Stage1Rule[] {
  if (!/\bpush\b/i.test(prose)) return []
  const branches = matchProtectedBranches(prose)
  const forceMentioned = /\bforce\b|--force\b|(?:^|\s)-f\b/i.test(prose)
  const rules: Stage1Rule[] = []

  for (const branch of branches) {
    rules.push({ tool: "bash", pattern: forcePushPattern(branch), verdict: deny(severity) })
    rules.push({ tool: "bash", pattern: normalPushPattern(branch), verdict: "FLAGGED" })
  }
  if (forceMentioned && branches.length === 0) {
    rules.push({ tool: "bash", pattern: anyForcePushPattern(), verdict: "FLAGGED" })
  }
  return rules
}

/**
 * "never modify .env", "don't touch .ssh", … → write/edit/apply_patch to that
 * path → DENY (hard) / FLAGGED (soft). `.env.example` is explicitly excluded.
 */
function compileProtectedPathRule(prose: string, severity: Severity): Stage1Rule[] {
  // Match verb STEMS so inflections count too: modify/modifying/modified,
  // edit/editing, change/changing, delete/deleting, write/writing, etc. A too-strict
  // exact-word gate would silently fail to compile a real protection rule.
  if (!/\b(modif|touch|writ|overwrit|edit|chang|delet|remov|alter|creat|put)\w*/i.test(prose)) return []
  return matchProtectedPaths(prose).flatMap((pathPattern) =>
    WRITE_TOOLS.map((tool) => ({ tool, pattern: pathPattern, verdict: deny(severity) })),
  )
}

const WRITE_TOOLS = ["write", "edit", "apply_patch"] as const

const deny = (severity: Severity): Stage1Verdict => (severity === "hard" ? "DENY" : "FLAGGED")

// ── Token extraction ─────────────────────────────────────────────────────────

const PROTECTED_BRANCH_TOKENS: readonly string[] = ["main", "master", "production", "prod", "release"]

function matchProtectedBranches(prose: string): string[] {
  return PROTECTED_BRANCH_TOKENS.filter((b) => new RegExp(`\\b${b}\\b`, "i").test(prose))
}

/** Returns ready-to-use path patterns for the protected paths named in `prose`. */
function matchProtectedPaths(prose: string): RegExp[] {
  // Emitted patterns match against the action string `tool:<path> <content>`, so the
  // protected name must begin a path SEGMENT — preceded by start, `/`, or the tool
  // prefix (any non-word, non-dot char) — otherwise `my.env`/`foo.git`/`secret.env`
  // would be falsely caught.
  const patterns: RegExp[] = []
  // `.env` is intentionally broad: it protects .env, .env.local, .env.production, …
  // (all real secret files) while excluding only the safe .env.example.
  if (/\.env\b/i.test(prose)) patterns.push(/(?:^|[^\w.])\.env\b(?!\.example)/i)
  // `.ssh` and `.git` are DIRECTORIES: match the dir itself or its contents (next char
  // is `/`, whitespace, or end), but NOT sibling files like .gitignore, .gitconfig,
  // .git-credentials, .sshd_config. `(?![\w.-])` is the correct trailing boundary —
  // a plain `\b` would still match `.git-attributes` (the boundary fires before `-`).
  // The `.git` prose guard mustn't depend on `.gitignore` absence (see the .gitignore test).
  if (/\.ssh\b/i.test(prose)) patterns.push(/(?:^|[^\w.])\.ssh(?![\w.-])/i)
  if (/\.git\b/i.test(prose)) patterns.push(/(?:^|[^\w.])\.git(?![\w.-])/i)
  return patterns
}

// ── Push pattern builders ────────────────────────────────────────────────────

const FORCE = "--force\\b|--force-with-lease\\b|(?:^|\\s)-f\\b"

function forcePushPattern(branch: string): RegExp {
  return new RegExp(`git\\s+push\\b(?=[^\\n]*\\b${escapeRe(branch)}\\b)(?=[^\\n]*(?:${FORCE}))`, "i")
}

function normalPushPattern(branch: string): RegExp {
  return new RegExp(`git\\s+push\\b[^\\n]*\\b${escapeRe(branch)}\\b`, "i")
}

function anyForcePushPattern(): RegExp {
  return new RegExp(`git\\s+push\\b(?=[^\\n]*(?:${FORCE}))`, "i")
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

// ── Stage 2 prompt text ──────────────────────────────────────────────────────

export function compileStage2Prompt(config: AutoModeConfig): string {
  const lines: string[] = []

  if (config.environment.length > 0) {
    lines.push("Project environment:")
    for (const rule of config.environment) lines.push(`- ${rule}`)
    lines.push("")
  }

  if (config.hardDeny.length > 0) {
    lines.push("HARD RULES (violating any = DENY, no exceptions):")
    for (const rule of config.hardDeny) lines.push(`- ${rule}`)
    lines.push("")
  }

  if (config.softDeny.length > 0) {
    lines.push("SOFT RULES (weigh against user intent; ALLOW only if clearly authorized):")
    for (const rule of config.softDeny) lines.push(`- ${rule}`)
    lines.push("")
  }

  return lines.join("\n")
}
