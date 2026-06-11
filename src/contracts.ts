/**
 * Contracts — pure type definitions with zero runtime dependencies.
 * Every module in opencode-ultra depends only on these contracts.
 * No module imports implementation details from another module.
 */

// ── Auto Mode ───────────────────────────────────────────────────────────────

/** Stage 1 heuristic verdict. Never "ALLOW" for ambiguous patterns — only for definitely-safe operations. */
export type Stage1Verdict = "ALLOW" | "FLAGGED" | "DENY"

/** A final, actionable verdict. FLAGGED is always resolved before it becomes final. */
export type FinalVerdict = "ALLOW" | "DENY"

/**
 * What Stage 2 can conclude: a clear verdict, or DEFER when it genuinely can't
 * decide (classifier unavailable or unparseable). DEFER means auto mode steps
 * aside and lets opencode's normal permission flow handle the action — it never
 * manufactures a denial, because Stage 1 already blocks the catastrophic set.
 */
export type ClassifierVerdict = FinalVerdict | "DEFER"

export interface Stage1Rule {
  readonly tool: string
  readonly pattern: RegExp
  readonly verdict: Stage1Verdict
}

export interface Stage2Classification {
  readonly verdict: ClassifierVerdict
  readonly reason: string
}

/** Everything the Stage 2 classifier reasons over for one action. */
export interface ClassificationRequest {
  readonly tool: string
  readonly params: string
  readonly userMessage: string
  readonly boundaries: readonly string[]
}

/** A resolved verdict for one action, with the reason that produced it. */
export interface CachedVerdict {
  readonly verdict: FinalVerdict
  readonly reason: string
}

/**
 * Per-session cache of resolved verdicts. Two indices over the same entries:
 *  - by normalized action `(tool, params)` with a TTL — lets a repeated action
 *    reuse a verdict instead of re-paying Stage 2.
 *  - by `callID` — lets the `permission.ask` hook replay the verdict the
 *    `tool.execute.before` hook just computed for the same tool call.
 */
export interface VerdictCache {
  /** Look up a still-fresh verdict for a normalized action. */
  lookup(tool: string, params: string): CachedVerdict | undefined
  /** Record a verdict, indexed by both action and callID. */
  record(tool: string, params: string, callID: string, verdict: CachedVerdict): void
  /** Read (and remove) the verdict for a callID — used by permission.ask. */
  consumeByCall(callID: string): CachedVerdict | undefined
  /** Drop everything (e.g. on compaction). */
  clear(): void
}

/** Model override for the Stage 2 classifier. */
export interface ClassifierModel {
  readonly providerID: string
  readonly modelID: string
}

export interface CompiledClassifierConfig {
  /** Explicit small/cheap model for classification. When undefined, the classifier agent's model is used. */
  readonly model?: ClassifierModel
  /** The agent the classifier session runs as (read-only; tools disabled per call). */
  readonly agent: string
  /** How long a verdict stays reusable for an identical action, in ms. */
  readonly cacheTtlMs: number
}

export interface AutoModeConfig {
  readonly enabled: boolean
  readonly defaultMode: boolean
  readonly environment: readonly string[]
  readonly allow: readonly string[]
  readonly softDeny: readonly string[]
  readonly hardDeny: readonly string[]
  readonly maxConsecutiveDenials: number
  readonly maxTotalDenials: number
  readonly classifier: CompiledClassifierConfig
}

export interface CompiledAutoModeConfig {
  /** Whether auto mode may run at all. When false the plugin is inert for auto mode. */
  readonly enabled: boolean
  /** When true (and enabled), auto mode activates automatically for new sessions. */
  readonly defaultMode: boolean
  readonly stage1Rules: readonly Stage1Rule[]
  readonly stage2PromptText: string
  readonly systemReminderText: string
  readonly maxConsecutiveDenials: number
  readonly maxTotalDenials: number
  readonly classifier: CompiledClassifierConfig
}

export interface AutoModeState {
  active: boolean
  paused: boolean
  consecutiveDenials: number
  totalDenials: number
  /** The most recent user message text, captured by messages.transform. */
  lastUserMessage: string
  /** Standing user constraints captured this session ("don't push", "wait for review"). */
  readonly boundaries: string[]
  /** Resolved-verdict cache (per session). */
  readonly verdicts: VerdictCache
}

// ── Ultracode ────────────────────────────────────────────────────────────────

export interface UltracodeConfig {
  readonly enabled: boolean
  readonly keywordTrigger: boolean
  readonly workflowRuntime: {
    readonly maxConcurrent: number
    readonly maxTotalAgents: number
    readonly maxConcurrentWorkflows: number
    readonly agentTimeout: number
    readonly workflowTimeout: number
    /** Per-workflow USD budget; 0 = unlimited. The engine stops spawning when projected spend exceeds it. */
    readonly maxCostUsd: number
    /** Retries for an agent whose prompt throws (transient errors); schema failures are not retried. */
    readonly agentRetries: number
  }
  readonly summarization: {
    readonly agentResultMaxChars: number
    readonly deduplicate: boolean
  }
  /** Directory (relative to the project) where run journals are written for resume. */
  readonly journalDir: string
}

export interface UltracodeState {
  active: boolean
  /** Set by ultracode: keyword detection, cleared after one turn. */
  singleTurn: boolean
}

// ── Workflow IR (declarative; no code execution) ──────────────────────────────

export type AgentType = "general" | "explore"

/** A field in a structured-output schema. */
export type OutputFieldSpec =
  | { readonly type: "string" | "number" | "boolean"; readonly required?: boolean }
  | { readonly type: "array"; readonly items: OutputSchema; readonly required?: boolean }

/** A minimal, fit-for-purpose structured-output schema (fail-fast validated, no external dep). */
export interface OutputSchema {
  readonly fields: Record<string, OutputFieldSpec>
}

/** One agent invocation. `schema` forces validated structured JSON output. */
export interface AgentSpec {
  readonly name: string
  readonly task: string
  readonly agent: AgentType
  readonly schema?: OutputSchema
}

/** A stage that runs a fixed set of named agents in parallel (one barrier at the end). */
export interface FanoutStage {
  readonly kind: "fanout"
  readonly name: string
  readonly agents: readonly AgentSpec[]
  readonly maxConcurrent?: number
  /** Run each agent in an isolated git worktree and merge results (for parallel mutation). */
  readonly isolate?: boolean
}

/** A stage that flows each item through an ordered list of steps with NO barrier between steps. */
export interface PipelineStage {
  readonly kind: "pipeline"
  readonly name: string
  readonly over: readonly string[]
  readonly steps: readonly AgentSpec[]
  readonly maxConcurrent?: number
}

/** A stage that adversarially verifies the findings of a prior stage (majority-refute drops). */
export interface VerifyStage {
  readonly kind: "verify"
  readonly name: string
  /** Name of a prior stage whose agents produced `{ findings: [...] }` structured output. */
  readonly source: string
  readonly task: string
  readonly agent: AgentType
  readonly voters: number
  /** Drop a finding when at least this many voters refute it. */
  readonly refuteThreshold: number
  /** Optional distinct verifier perspectives (one voter per lens, overriding `voters`). */
  readonly lenses?: readonly string[]
}

/** A stage that repeats a fanout body until a round adds no new findings (loop-until-dry). */
export interface LoopStage {
  readonly kind: "loop"
  readonly name: string
  readonly body: FanoutStage
  readonly maxIterations: number
  /** Finding field used to detect novelty across iterations. */
  readonly dedupeKey: string
}

export type Stage = FanoutStage | PipelineStage | VerifyStage | LoopStage
export type StageKind = Stage["kind"]

export interface WorkflowDef {
  readonly title: string
  readonly stages: readonly Stage[]
}

// ── Workflow results ──────────────────────────────────────────────────────────

export type AgentStatus = "completed" | "error"

export interface AgentResult {
  readonly name: string
  readonly status: AgentStatus
  readonly text: string
  /** Validated structured output, present iff the agent declared a schema and succeeded. */
  readonly data?: Record<string, unknown>
  readonly error?: string
  readonly cost: number
  readonly tokens: number
}

/** A single finding flattened from a stage's structured `{ findings: [...] }` output. */
export type Finding = Record<string, unknown>

export interface StageResult {
  readonly stage: string
  readonly kind: StageKind
  readonly agents: readonly AgentResult[]
  /** Findings flattened across the stage's agents (empty unless they emit a findings array). */
  readonly findings: readonly Finding[]
}

export type WorkflowResults = Record<string, StageResult>

// ── Cost / budget ─────────────────────────────────────────────────────────────

export interface CostEstimate {
  readonly agents: number
  readonly estimatedTokens: number
  readonly estimatedTime: string
  readonly estimatedCost: string
}

export interface BudgetReport {
  readonly spentUsd: number
  readonly spentTokens: number
  readonly limitUsd: number
  readonly exhausted: boolean
  /** Agents skipped because the budget ran out (never silently dropped). */
  readonly droppedAgents: number
}

// ── Validation ────────────────────────────────────────────────────────────────

export interface ValidationResult {
  readonly id: string
  readonly valid: boolean
  readonly stages: number
  readonly agents: number
  readonly maxConcurrent: number
  readonly estimate: CostEstimate
  readonly errors: readonly string[]
}

// ── Observability ─────────────────────────────────────────────────────────────

export type AgentRunStatus = "queued" | "running" | "completed" | "error"

export interface AgentProgress {
  readonly stage: string
  readonly name: string
  status: AgentRunStatus
}

export interface WorkflowProgress {
  stageIndex: number
  readonly totalStages: number
  readonly agents: AgentProgress[]
}

// ── Job ───────────────────────────────────────────────────────────────────────

export type WorkflowStatus = "pending" | "running" | "completed" | "error" | "cancelled" | "paused"

/** Cooperative controls polled by the engine so pause/stop/timeout actually take effect. */
export interface WorkflowControl {
  shouldStop?: () => boolean
  isPaused?: () => boolean
  /** Returns the current time in ms; when omitted, the workflow timeout is not enforced. */
  now?: () => number
}

export interface WorkflowJob {
  readonly id: string
  readonly title: string
  readonly def: WorkflowDef
  status: WorkflowStatus
  readonly progress: WorkflowProgress
  /** Final summarized output, populated once execution completes. */
  result?: string
  budget?: BudgetReport
  execute(): Promise<void>
  pause(): void
  resume(): void
  stop(): void
  statusReport(): string
  summarizedOutput(): string
}

export interface WorkflowState {
  readonly jobs: Map<string, WorkflowJob>
  readonly completedJobs: WorkflowJob[]
  shutdown(): void
}

// ── Plugin State ─────────────────────────────────────────────────────────────

/** All per-session state. One instance per opencode session. */
export interface SessionState {
  readonly autoMode: AutoModeState
  readonly ultracode: UltracodeState
}

/** Owns per-session state, keyed by sessionID. */
export interface SessionStore {
  /** Get existing state, or undefined if this session has none yet. */
  peek(sessionID: string): SessionState | undefined
  /** Get state for a session, creating it (per config defaults) on first use. */
  get(sessionID: string): SessionState
  /** Drop a session's state (on session.deleted). */
  remove(sessionID: string): void
  /** All live session states (e.g. to dispose on shutdown). */
  all(): readonly SessionState[]
}

/** Top-level plugin state: per-session state plus the global workflow registry. */
export interface UltraState {
  readonly sessions: SessionStore
  readonly workflows: WorkflowState
}

// ── Config ───────────────────────────────────────────────────────────────────

export interface CompiledConfig {
  readonly autoMode: CompiledAutoModeConfig
  readonly ultracode: UltracodeConfig
  readonly warnings: readonly string[]
}

export interface RawAutoModeConfig {
  enabled?: boolean
  defaultMode?: boolean
  environment?: string[]
  allow?: string[]
  softDeny?: string[]
  hardDeny?: string[]
  maxConsecutiveDenials?: number
  maxTotalDenials?: number
  classifier?: {
    /** "providerID/modelID" string selecting the small/cheap classifier model. */
    model?: string
    /** Agent the classifier runs as (default "title"). */
    agent?: string
    /** Verdict cache TTL for identical actions, in ms. */
    cacheTtlMs?: number
  }
}

export interface RawUltracodeConfig {
  enabled?: boolean
  keywordTrigger?: boolean
  workflowRuntime?: {
    maxConcurrent?: number
    maxTotalAgents?: number
    maxConcurrentWorkflows?: number
    agentTimeout?: number
    workflowTimeout?: number
    maxCostUsd?: number
    agentRetries?: number
  }
  summarization?: {
    agentResultMaxChars?: number
    deduplicate?: boolean
  }
  journalDir?: string
}

/** The shape of autoMode + ultracode blocks in the user's opencode.json. */
export interface RawOpenCodeUltraConfig {
  autoMode?: RawAutoModeConfig
  ultracode?: RawUltracodeConfig
}
