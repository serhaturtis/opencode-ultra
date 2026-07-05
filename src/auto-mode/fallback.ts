/**
 * Fallback tracker — denial counter logic for auto mode.
 *
 * Tracks consecutive and total denials. When thresholds are exceeded,
 * auto mode pauses until the user explicitly approves an action.
 * Counters reset on compaction.
 */
import { type AutoModeState } from "../contracts.js"

/**
 * Records a denial. Returns true if auto mode should pause
 * (threshold exceeded), false otherwise.
 */
export function recordDenial(
  state: AutoModeState,
  maxConsecutive: number,
  maxTotal: number,
): boolean {
  state.consecutiveDenials++
  state.totalDenials++

  if (state.consecutiveDenials >= maxConsecutive || state.totalDenials >= maxTotal) {
    state.paused = true
    return true
  }

  return false
}

/**
 * Records an approval. Resets consecutive denials, resumes if paused.
 * totalDenials is NOT reset — it's a session-lifetime circuit breaker.
 */
export function recordApproval(state: AutoModeState): void {
  state.consecutiveDenials = 0
  if (state.active && state.paused) state.paused = false
}

/**
 * Called on context compaction. Resets counters, pauses state, clears cache.
 */
export function onCompaction(state: AutoModeState): void {
  state.consecutiveDenials = 0
  state.totalDenials = 0
  state.paused = false
  state.verdicts.clear()
  // Standing instructions live in the (now summarized) context; drop them too.
  state.boundaries.length = 0
}

/**
 * Activate auto mode — initialize all state.
 */
export function activate(state: AutoModeState): void {
  state.active = true
  state.paused = false
  state.consecutiveDenials = 0
  state.totalDenials = 0
  state.verdicts.clear()
  state.boundaries.length = 0
}

/**
 * Deactivate auto mode — reset all state.
 */
export function deactivate(state: AutoModeState): void {
  state.active = false
  state.paused = false
  state.consecutiveDenials = 0
  state.totalDenials = 0
  state.verdicts.clear()
  state.boundaries.length = 0
}
