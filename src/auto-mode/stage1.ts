/**
 * Stage 1 — Heuristic fast filter.
 *
 * Zero-token, zero-latency classification via regex patterns.
 * DENY only for catastrophically unambiguous patterns.
 * Everything ambiguous → FLAGGED (escalated to Stage 2).
 *
 * This module is pure — no I/O, no state, no side effects.
 */
import { type Stage1Verdict, type Stage1Rule } from "../contracts.js"

// ── Classification ───────────────────────────────────────────────────────────

/** Shell control operators that chain, redirect, or substitute commands — including newline. */
const SHELL_CONTROL_OPERATORS = /[|<>;&`\n]|\$\(/

const SHELL_TOOLS: ReadonlySet<string> = new Set(["bash", "shell"])

export function classify(
  tool: string,
  params: unknown,
  rules: readonly Stage1Rule[],
): Stage1Verdict {
  // AM-03: use the MATCH string (path-only for write tools) so Stage 1 patterns
  // like .env aren't matched against file content, which caused false FLAGGED.
  const matchString = extractMatchString(tool, params)
  if (!matchString) return "FLAGGED"

  // Check DENY first — these take priority
  for (const rule of rules) {
    if (rule.verdict !== "DENY") continue
    if (rule.tool !== tool && rule.tool !== "*") continue
    if (rule.pattern.test(matchString)) return "DENY"
  }

  // A shell command with control operators may do far more than its prefix
  // suggests — never fast-path ALLOW it; let Stage 2 reason about the whole line.
  const actionString = extractActionString(tool, params)
  if (SHELL_TOOLS.has(tool) && SHELL_CONTROL_OPERATORS.test(actionString)) {
    return "FLAGGED"
  }

  // Explicit FLAGGED rules (e.g. soft-protected paths like .env) — checked BEFORE
  // ALLOW so they take priority over any broad/catch-all ALLOW pattern below.
  for (const rule of rules) {
    if (rule.verdict !== "FLAGGED") continue
    if (rule.tool !== tool && rule.tool !== "*") continue
    if (rule.pattern.test(matchString)) return "FLAGGED"
  }

  // Then ALLOW
  for (const rule of rules) {
    if (rule.verdict !== "ALLOW") continue
    if (rule.tool !== tool && rule.tool !== "*") continue
    if (rule.pattern.test(matchString)) return "ALLOW"
  }

  // Everything else → escalated
  return "FLAGGED"
}

// ── String Extraction ────────────────────────────────────────────────────────

/**
 * Extract the safety-relevant action string from tool parameters.
 * Used by Stage 1 matching, verdict cache key, and Stage 2 prompt.
 */
export function extractActionString(tool: string, params: unknown): string {
  if (typeof params !== "object" || params === null) return ""

  switch (tool) {
    case "bash":
    case "shell": {
      const p = params as Record<string, unknown>
      const cmd = typeof p.command === "string" ? p.command : ""
      const cwd = typeof p.cwd === "string" ? p.cwd : ""
      // Only the env var NAMES are classification-relevant. Never include VALUES —
      // they may be secrets and this string is cached and sent to the Stage 2 LLM.
      const env = typeof p.env === "object" && p.env !== null
        ? `env:${Object.keys(p.env as Record<string, unknown>).join(",")}`
        : ""
      return [cmd, cwd ? `cwd:${cwd}` : "", env].filter(Boolean).join(" ")
    }

    case "webfetch": {
      const p = params as Record<string, unknown>
      const url = typeof p.url === "string" ? p.url : ""
      const method = typeof p.method === "string" ? p.method : "GET"
      return `${method} ${url}`
    }

    case "websearch": {
      const p = params as Record<string, unknown>
      return typeof p.query === "string" ? `search:${p.query}` : ""
    }

    case "task": {
      const p = params as Record<string, unknown>
      const desc = typeof p.description === "string" ? p.description : ""
      const agent = typeof p.subagent_type === "string" ? p.subagent_type : ""
      const prompt = typeof p.prompt === "string" ? p.prompt : ""
      return `${desc} agent:${agent} ${prompt}`
    }

    case "write":
    case "edit":
    case "apply_patch": {
      const p = params as Record<string, unknown>
      const path = typeof p.filePath === "string" ? p.filePath : ""
      const content = typeof p.content === "string" ? p.content.slice(0, 200) : ""
      return `${tool}:${path} ${content}`
    }

    case "read": {
      const p = params as Record<string, unknown>
      const path = typeof p.filePath === "string" ? p.filePath : ""
      return `${tool}:${path}`
    }

    default: {
      // For MCP tools and unknown tools: serialize params to a searchable string
      try {
        return JSON.stringify(params).slice(0, 500)
      } catch {
        return ""
      }
    }
  }
}

function extractMatchString(tool: string, params: unknown): string {
  if (typeof params !== "object" || params === null) return ""

  switch (tool) {
    case "bash":
    case "shell":
      // Match against the command only — the cwd/env suffix breaks $ anchors.
      return typeof (params as Record<string, unknown>).command === "string"
        ? (params as Record<string, unknown>).command as string
        : ""
    case "write":
    case "edit":
    case "apply_patch": {
      const p = params as Record<string, unknown>
      return `${tool}:${typeof p.filePath === "string" ? p.filePath : ""}`
    }
    default:
      return extractActionString(tool, params)
  }
}

// ── Utility ──────────────────────────────────────────────────────────────────

export function isToolAlwaysSafe(tool: string): boolean {
  return ALWAYS_SAFE_TOOLS.has(tool)
}

const ALWAYS_SAFE_TOOLS: ReadonlySet<string> = new Set([
  "read", "glob", "grep", "todowrite", "skill", "lsp",
  // This plugin's own orchestration tools: pure control flow, no direct I/O.
  // The subagents a workflow spawns are each classified on their own actions.
  "workflow", "workflow-manager",
])
