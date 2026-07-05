/**
 * Built-in defaults: DENY patterns, ALLOW patterns, and prose rules.
 * All exports are deep-frozen — module-shared across every session.
 */
import { type Stage1Rule } from "../contracts.js"
import { deepFreeze } from "../freeze.js"

// ── Prose Rules (used in Stage 2 classification prompt + system reminder) ────

export const DEFAULTS = deepFreeze({
  environment: [
    "The working directory is the project root.",
    "Source control and package managers are trusted tools within the project.",
  ],

  allow: [
    "Installing packages declared in lockfiles (npm install, pip install, cargo build) is allowed.",
    "Running test suites (npm test, pytest, cargo test) is allowed.",
    "Read-only HTTP requests to documentation sites and package registries are allowed.",
  ],

  softDeny: [
    "Ask before pushing to any remote branch.",
    "Ask before running database migrations.",
    "Ask before modifying .env files (except .env.example).",
    "Ask before modifying CI/CD configuration files.",
    "Ask before deploying to any environment.",
    "Ask before sending data to external APIs or services.",
    "Ask before installing packages not declared in lockfiles.",
  ],

  hardDeny: [
    "Never push to main or master branch.",
    "Never force push to any branch.",
    "Never execute remote code (curl/wget piped to shell, eval of downloaded content).",
    "Never run destructive filesystem commands (rm -rf, format, dd) outside build directories.",
    "Never send credentials, tokens, or environment variable values to external endpoints.",
    "Never modify system configuration outside this project directory.",
  ],
} as const)

// ── Stage 1 Patterns ──────────────────────────────────────────────────────────

/** Catastrophic patterns — immediate DENY, no Stage 2 needed. */
const DENY_PATTERNS: readonly Stage1Rule[] = deepFreeze([
  // Root target must be EXACTLY / or /* or ~ (followed by whitespace/end) — otherwise
  // the bare `/` alternative matches the leading slash of any path (e.g. /tmp/build),
  // hard-denying legitimate scoped deletes that should instead escalate to Stage 2.
  { tool: "bash", pattern: /rm\s+(-[a-z]*r[a-z]*f?\s+|-rf\s+|--recursive\s+--force\s+)(\/\*|\/|~)(?:\s|$)/i, verdict: "DENY" },
  { tool: "bash", pattern: />\s*\/dev\/sd[a-z]\d?/i, verdict: "DENY" },
  { tool: "bash", pattern: /dd\s+.*\bof=\/dev\//i, verdict: "DENY" },
  { tool: "bash", pattern: /mkfs\.\w+/i, verdict: "DENY" },
  { tool: "bash", pattern: /curl\s+.*\|\s*(ba)?sh\b/i, verdict: "DENY" },
  { tool: "bash", pattern: /wget\s+.*\|\s*(ba)?sh\b/i, verdict: "DENY" },
  { tool: "bash", pattern: /chmod\s+(-[a-z]*R[a-z]*\s+)?777\s+(\/\*|\/)(?:\s|$)/i, verdict: "DENY" },
])

/** Definitely-safe patterns — immediate ALLOW, no Stage 2 needed. */
const ALLOW_PATTERNS: readonly Stage1Rule[] = deepFreeze([
  // `ci` (clean lockfile install) is safe like a bare `install`; `install` is allowed
  // ONLY bare or with flags — never with a package argument (`npm install lodash`),
  // which must go to Stage 2.
  { tool: "bash", pattern: /^(npm|yarn|pnpm)\s+(test|ci(?:\s|$)|run\s+(?:test|build|lint|typecheck)|install(?:\s+-\S+)*\s*$)/, verdict: "ALLOW" },
  { tool: "bash", pattern: /^(cargo)\s+(test|build|check|clippy|fmt\b)/, verdict: "ALLOW" },
  { tool: "bash", pattern: /^(go)\s+(test|build|vet|lint|fmt\b)/, verdict: "ALLOW" },
  { tool: "bash", pattern: /^(pytest|python[0-9.]*\s+-m\s+(?:pytest|unittest))/, verdict: "ALLOW" },
  // Python/JS env runners wrapping a safe test/lint/type command (uv run pytest, etc.).
  { tool: "bash", pattern: /^(uv|poetry|pdm|pipenv|rye|hatch)\s+run\s+(pytest|python[0-9.]*\s+-m\s+(?:pytest|unittest)|ruff\b|mypy\b|pyright\b|black\b|isort\b|flake8\b)/, verdict: "ALLOW" },
  { tool: "bash", pattern: /^(make|just)\s+/, verdict: "ALLOW" },
  // Each subcommand must be followed by whitespace or end — `\b` would also match
  // a hyphen, allowing e.g. `git checkout-index` / `git commit-tree`.
  { tool: "bash", pattern: /^(git)\s+(status|diff|add|commit|branch|log|stash|checkout|switch|restore)(?:\s|$)/, verdict: "ALLOW" },
  { tool: "bash", pattern: /^(mkdir|touch|cp|mv|ls|cat|echo|printf|dirname|basename)\s/, verdict: "ALLOW" },
  { tool: "bash", pattern: /^(which|whereis|type|command\s+-v)\s/, verdict: "ALLOW" },
  { tool: "read", pattern: /.*/, verdict: "ALLOW" },
  { tool: "glob", pattern: /.*/, verdict: "ALLOW" },
  { tool: "grep", pattern: /.*/, verdict: "ALLOW" },
  // Editing files is the agent's core work — fast-allow it deterministically rather
  // than gating every edit on the Stage 2 LLM (slow, and an unreliable dependency).
  // Writes to PROTECTED paths (.env/.ssh/.git and any configured) are matched first
  // by the DENY/FLAGGED tiers in classify(), so they never fall through to here.
  { tool: "write", pattern: /.*/, verdict: "ALLOW" },
  { tool: "edit", pattern: /.*/, verdict: "ALLOW" },
  { tool: "apply_patch", pattern: /.*/, verdict: "ALLOW" },
  { tool: "todowrite", pattern: /.*/, verdict: "ALLOW" },
  { tool: "skill", pattern: /.*/, verdict: "ALLOW" },
  { tool: "lsp", pattern: /.*/, verdict: "ALLOW" },
])

/** All built-in Stage 1 rules — DENY + ALLOW combined (deep-frozen, rule objects included). */
export const STAGE1_RULES: readonly Stage1Rule[] = deepFreeze([
  ...DENY_PATTERNS,
  ...ALLOW_PATTERNS,
])
