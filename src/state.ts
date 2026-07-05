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
  type WorktreeReclaimer,
} from "./contracts.js"
import { TtlVerdictCache } from "./auto-mode/verdict-cache.js"

// ── Top-level factory ──────────────────────────────────────────────────────

export function createState(getConfig: () => CompiledConfig, worktrees?: WorktreeReclaimer): UltraState {
  return {
    sessions: createSessionStore(getConfig),
    workflows: createWorkflowState(worktrees),
  }
}

// ── Session store ──────────────────────────────────────────────────────────

const SESSION_TTL_MS = 3600_000 // 1 hour — sessions unreferenced for longer are evicted

function createSessionStore(getConfig: () => CompiledConfig): SessionStore {
  const sessions = new Map<string, SessionState>()
  let lastSweep = Date.now()
  const maybeSweep = () => {
    const now = Date.now()
    if (now - lastSweep > 60_000) { evictExpired(sessions, now, SESSION_TTL_MS); lastSweep = now }
  }
  return {
    peek: (sessionID) => { maybeSweep(); return sessions.get(sessionID) },
    get(sessionID) {
      let state = sessions.get(sessionID)
      if (!state) {
        maybeSweep()
        state = createSessionState(getConfig())
        sessions.set(sessionID, state)
      }
      return state
    },
    remove: (sessionID) => { sessions.delete(sessionID) },
    all: () => [...sessions.values()],
  }
}

function evictExpired(sessions: Map<string, SessionState>, now: number, ttlMs: number): void {
  for (const [id, s] of sessions) {
    if (now - s.createdAt > ttlMs) sessions.delete(id)
  }
}

function createSessionState(config: CompiledConfig): SessionState {
  const auto = config.autoMode
  return {
    createdAt: Date.now(),
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

function createWorkflowState(worktrees?: WorktreeReclaimer): WorkflowState {
  const jobs = new Map<string, WorkflowJob>()
  const completedJobs: WorkflowJob[] = []

  return {
    jobs,
    completedJobs,
    worktrees,
    async shutdown(log) {
      for (const job of [...jobs.values()]) job.stop()
      if (worktrees) await worktrees.cleanupAllActive(log)
      jobs.clear()
    },
    stopForSession(sessionId) {
      const stopped: string[] = []
      for (const job of [...jobs.values()]) {
        if (job.parentSessionId === sessionId) { job.stop(); stopped.push(job.id) }
      }
      return stopped
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
