/**
 * Configuration composition root. Composes the subsystem compilers into the
 * immutable CompiledConfig. Owns no subsystem logic — it only calls compilers.
 */
import { type CompiledConfig, type RawOpenCodeUltraConfig } from "./contracts.js"
import { compileAutoModeConfig, disabledAutoModeConfig } from "./auto-mode/config.js"
import { compileUltracodeConfig, DEFAULT_ULTRACODE_CONFIG } from "./ultracode/config.js"
import { deepFreeze } from "./freeze.js"

export function compileConfig(raw: RawOpenCodeUltraConfig): CompiledConfig {
  const warnings: string[] = []
  const autoMode = compileAutoModeConfig(raw.autoMode ?? {}, warnings)
  const ultracode = compileUltracodeConfig(raw.ultracode ?? {})
  return deepFreeze({ autoMode, ultracode, warnings: Object.freeze(warnings) })
}

/** Boot config — everything disabled, using subsystem defaults (single source). */
export const DEFAULT_DISABLED_CONFIG: CompiledConfig = deepFreeze({
  autoMode: disabledAutoModeConfig(),
  ultracode: DEFAULT_ULTRACODE_CONFIG,
  warnings: Object.freeze([]),
})
