/**
 * Per-session TTL verdict cache with two indices:
 *  - by (tool, params) — reuse verdicts for repeated identical actions
 *  - by callID — so permission.ask can replay the verdict from tool.execute.before
 */
import { type CachedVerdict, type VerdictCache } from "../contracts.js"

interface ActionEntry {
  readonly verdict: CachedVerdict
  readonly expiresAt: number
}

const SEP = "\u0000" // NUL — cannot appear in a tool name or command string

export class TtlVerdictCache implements VerdictCache {
  private readonly byAction = new Map<string, ActionEntry>()
  private readonly byCall = new Map<string, CachedVerdict>()

  constructor(
    private readonly ttlMs: number,
    private readonly now: () => number = Date.now,
    private readonly maxEntries = 512,
  ) {}

  private static key(tool: string, params: string): string {
    return `${tool}${SEP}${params}`
  }

  lookup(tool: string, params: string): CachedVerdict | undefined {
    const key = TtlVerdictCache.key(tool, params)
    const entry = this.byAction.get(key)
    if (!entry) return undefined
    if (entry.expiresAt <= this.now()) {
      this.byAction.delete(key)
      return undefined
    }
    return entry.verdict
  }

  record(tool: string, params: string, callID: string, verdict: CachedVerdict): void {
    evictOldest(this.byAction, this.maxEntries)
    evictOldest(this.byCall, this.maxEntries)
    this.byAction.set(TtlVerdictCache.key(tool, params), { verdict, expiresAt: this.now() + this.ttlMs })
    this.byCall.set(callID, verdict)
  }

  consumeByCall(callID: string): CachedVerdict | undefined {
    const verdict = this.byCall.get(callID)
    if (verdict) this.byCall.delete(callID)
    return verdict
  }

  clear(): void {
    this.byAction.clear()
    this.byCall.clear()
  }
}

/** Evict the oldest entry when at capacity (Map preserves insertion order). */
function evictOldest(map: Map<string, unknown>, max: number): void {
  if (map.size < max) return
  const oldest = map.keys().next().value
  if (oldest !== undefined) map.delete(oldest)
}
