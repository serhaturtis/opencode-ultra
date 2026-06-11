/**
 * State module — the runtime state factory.
 *
 * Auto-mode and ultracode state are per-session (keyed by sessionID); the
 * workflow registry is global (workflows are keyed by their own id). State
 * transitions (activate/deactivate/deny/approve/compact) live in
 * auto-mode/fallback.ts — this module only creates and stores state.
 */
import {
  type CompiledConfig,
  type SessionState,
  type SessionStore,
  type UltraState,
  type WorkflowJob,
  type WorkflowState,
} from "./contracts.js"
import { TtlVerdictCache } from "./auto-mode/verdict-cache.js"

// ── Top-level factory ──────────────────────────────────────────────────────

export function createState(getConfig: () => CompiledConfig): UltraState {
  return {
    sessions: createSessionStore(getConfig),
    workflows: createWorkflowState(),
  }
}

// ── Session store ──────────────────────────────────────────────────────────

function createSessionStore(getConfig: () => CompiledConfig): SessionStore {
  const sessions = new Map<string, SessionState>()
  return {
    peek: (sessionID) => sessions.get(sessionID),
    get(sessionID) {
      let state = sessions.get(sessionID)
      if (!state) {
        state = createSessionState(getConfig())
        sessions.set(sessionID, state)
      }
      return state
    },
    remove: (sessionID) => { sessions.delete(sessionID) },
    all: () => [...sessions.values()],
  }
}

function createSessionState(config: CompiledConfig): SessionState {
  const auto = config.autoMode
  return {
    autoMode: {
      // New sessions start active only when auto mode is both enabled and default.
      active: auto.enabled && auto.defaultMode,
      paused: false,
      consecutiveDenials: 0,
      totalDenials: 0,
      lastUserMessage: "",
      boundaries: [],
      verdicts: new TtlVerdictCache(auto.classifier.cacheTtlMs),
    },
    ultracode: {
      active: config.ultracode.enabled,
      singleTurn: false,
    },
  }
}

// ── Workflow registry ──────────────────────────────────────────────────────

function createWorkflowState(): WorkflowState {
  const jobs = new Map<string, WorkflowJob>()
  const completedJobs: WorkflowJob[] = []

  return {
    jobs,
    completedJobs,
    shutdown() {
      for (const job of jobs.values()) {
        try { job.stop() } catch { /* best effort */ }
      }
      jobs.clear()
    },
  }
}

/** Cap retained completed jobs — the plugin process is long-lived; the registry must not grow without bound. */
const MAX_COMPLETED_JOBS = 50

/**
 * Move a job from the active set to the completed list — exactly once.
 * Idempotent: a stop() racing with natural completion can't double-record it.
 */
export function completeJob(state: UltraState, job: WorkflowJob): void {
  if (state.workflows.jobs.has(job.id)) {
    state.workflows.jobs.delete(job.id)
    const completed = state.workflows.completedJobs
    completed.push(job)
    while (completed.length > MAX_COMPLETED_JOBS) completed.shift()
  }
}
