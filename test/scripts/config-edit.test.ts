import { describe, it, expect } from "vitest"
import {
  withPlugin, withoutPlugin, getPluginOptions, withPluginOptions, featureOptions, stripLegacyKeys,
} from "../../scripts/config-edit.js"

describe("withPlugin (bare string entries)", () => {
  it("adds the plugin to an empty config", () => {
    expect(withPlugin({}, "/abs")).toEqual({ plugin: ["/abs"] })
  })
  it("appends and preserves other keys", () => {
    expect(withPlugin({ plugin: ["a"], $schema: "x" }, "/abs")).toEqual({ plugin: ["a", "/abs"], $schema: "x" })
  })
  it("is idempotent even when present as a tuple", () => {
    const cfg = { plugin: [["/abs", { autoMode: {} }]] }
    expect(withPlugin(cfg, "/abs")).toBe(cfg)
  })
})

describe("withoutPlugin (matches strings and tuples)", () => {
  it("removes a bare string entry and drops an empty array", () => {
    expect(withoutPlugin({ plugin: ["/abs"], $schema: "x" }, "/abs")).toEqual({ $schema: "x" })
  })
  it("removes a tuple entry by ref", () => {
    expect(withoutPlugin({ plugin: [["/abs", { x: 1 }], "other"] }, "/abs")).toEqual({ plugin: ["other"] })
  })
  it("is idempotent when absent", () => {
    const cfg = { plugin: ["a"] }
    expect(withoutPlugin(cfg, "/abs")).toBe(cfg)
  })
})

describe("getPluginOptions / withPluginOptions", () => {
  it("returns {} for a bare or absent entry, and the options for a tuple", () => {
    expect(getPluginOptions({ plugin: ["/abs"] }, "/abs")).toEqual({})
    expect(getPluginOptions({ plugin: [["/abs", { a: 1 }]] }, "/abs")).toEqual({ a: 1 })
    expect(getPluginOptions({}, "/abs")).toEqual({})
  })
  it("registers a [ref, options] tuple, replacing any prior entry and preserving others", () => {
    const out = withPluginOptions({ plugin: ["/abs", "other"] }, "/abs", { autoMode: { enabled: true } })
    expect(out.plugin).toEqual(["other", ["/abs", { autoMode: { enabled: true } }]])
  })
})

describe("featureOptions", () => {
  it("enables both features from scratch", () => {
    expect(featureOptions()).toEqual({
      autoMode: { defaultMode: false, enabled: true },
      ultracode: { enabled: true },
    })
  })
  it("preserves existing options and forces enabled: true", () => {
    const out = featureOptions({
      autoMode: { enabled: false, defaultMode: true, hardDeny: ["never push to main"] },
      ultracode: { keywordTrigger: false },
    }) as any
    expect(out.autoMode).toEqual({ defaultMode: true, enabled: true, hardDeny: ["never push to main"] })
    expect(out.ultracode).toEqual({ keywordTrigger: false, enabled: true })
  })
})

describe("stripLegacyKeys", () => {
  it("removes top-level autoMode/ultracode, preserving the rest", () => {
    expect(stripLegacyKeys({ autoMode: {}, ultracode: {}, plugin: ["/abs"] })).toEqual({ plugin: ["/abs"] })
  })
  it("is a no-op (same reference) when there are no legacy keys", () => {
    const cfg = { plugin: ["/abs"] }
    expect(stripLegacyKeys(cfg)).toBe(cfg)
  })
})
