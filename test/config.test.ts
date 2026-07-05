import { describe, it, expect } from "vitest"
import { deepFreeze } from "../src/freeze"
import { compileConfig, DEFAULT_DISABLED_CONFIG } from "../src/config"
import * as coreConfig from "../src/config"
import { DEFAULT_AUTO_MODE_CONFIG } from "../src/auto-mode/config"
import { DEFAULT_ULTRACODE_CONFIG } from "../src/ultracode/config"
import { STAGE1_RULES, DEFAULTS } from "../src/auto-mode/defaults"

describe("deepFreeze", () => {
  it("freezes nested objects and arrays", () => {
    const x = deepFreeze({ a: [1, { b: 2 }] })
    expect(Object.isFrozen(x)).toBe(true)
    expect(Object.isFrozen(x.a)).toBe(true)
    expect(Object.isFrozen(x.a[1])).toBe(true)
  })

  it("does not freeze RegExp (would break stateful lastIndex use)", () => {
    const re = /foo/g
    deepFreeze({ re })
    expect(Object.isFrozen(re)).toBe(false)
  })

  it("deepens a shallow-frozen value (recurse before freezing the outer)", () => {
    // A shallow Object.freeze leaves the inner array mutable; deepFreeze must fix that.
    const shallow = Object.freeze({ inner: [1, 2] })
    deepFreeze(shallow)
    expect(Object.isFrozen(shallow.inner)).toBe(true)
  })

  it("is idempotent", () => {
    const x = deepFreeze({ a: [1] })
    expect(() => deepFreeze(x)).not.toThrow()
    expect(Object.isFrozen(x.a)).toBe(true)
  })
})

describe("config layering (ARCH-004)", () => {
  it("compileConfig composes the subsystem compilers and flows warnings", () => {
    const cfg = compileConfig({
      autoMode: { enabled: true, hardDeny: ["a deliberately vague thing"] },
      ultracode: { enabled: true },
    })
    expect(cfg.autoMode.enabled).toBe(true)
    expect(cfg.ultracode.enabled).toBe(true)
    expect(cfg.warnings.some((w) => /too vague/i.test(w))).toBe(true)
  })

  it("core config no longer embeds subsystem compilation logic", () => {
    // The compiler functions and their helpers live in the subsystems. The core
    // config module must not re-export or define parseClassifierModel/validateRules/
    // isVague/resolveDefaults — those moved to auto-mode/config.
    const coreConfigExports = Object.keys(coreConfig)
    for (const moved of ["compileAutoMode", "parseClassifierModel", "validateRules", "isVague", "resolveDefaults"]) {
      expect(coreConfigExports).not.toContain(moved)
    }
  })
})

describe("immutability of shared defaults (ARCH-009 / ARCH-010)", () => {
  it("STAGE1_RULES rule objects are frozen, not just the array", () => {
    expect(Object.isFrozen(STAGE1_RULES)).toBe(true)
    expect(STAGE1_RULES.length).toBeGreaterThan(0)
    for (const rule of STAGE1_RULES) expect(Object.isFrozen(rule)).toBe(true)
  })

  it("DEFAULTS prose arrays are frozen", () => {
    expect(Object.isFrozen(DEFAULTS)).toBe(true)
    expect(Object.isFrozen(DEFAULTS.allow)).toBe(true)
    expect(Object.isFrozen(DEFAULTS.hardDeny)).toBe(true)
  })

  it("compiled configs are deep-frozen", () => {
    const cfg = compileConfig({ autoMode: { enabled: true } })
    expect(Object.isFrozen(cfg)).toBe(true)
    expect(Object.isFrozen(cfg.autoMode)).toBe(true)
    expect(Object.isFrozen(cfg.autoMode.stage1Rules)).toBe(true)
  })
})

describe("DEFAULT_DISABLED_CONFIG single-source (AM-08)", () => {
  it("denial thresholds match DEFAULT_AUTO_MODE_CONFIG, not a hardcoded copy", () => {
    // Regression: this previously hardcoded 3/20, which drifted from the real
    // default when it changed. It now references the single source of truth.
    expect(DEFAULT_DISABLED_CONFIG.autoMode.maxConsecutiveDenials).toBe(DEFAULT_AUTO_MODE_CONFIG.maxConsecutiveDenials)
    expect(DEFAULT_DISABLED_CONFIG.autoMode.maxTotalDenials).toBe(DEFAULT_AUTO_MODE_CONFIG.maxTotalDenials)
    expect(DEFAULT_DISABLED_CONFIG.autoMode.classifier).toBe(DEFAULT_AUTO_MODE_CONFIG.classifier)
  })

  it("is fully disabled and deep-frozen", () => {
    expect(DEFAULT_DISABLED_CONFIG.autoMode.enabled).toBe(false)
    expect(DEFAULT_DISABLED_CONFIG.ultracode).toBe(DEFAULT_ULTRACODE_CONFIG)
    expect(Object.isFrozen(DEFAULT_DISABLED_CONFIG)).toBe(true)
  })
})
