import { describe, it, expect } from "vitest"
import { parseJsonc, stripJsonc } from "../../scripts/jsonc.js"

describe("parseJsonc: strict JSON passes through unchanged", () => {
  it("parses objects, arrays, and nesting", () => {
    expect(parseJsonc('{"a":1,"b":[2,3],"c":{"d":true}}')).toEqual({ a: 1, b: [2, 3], c: { d: true } })
    expect(parseJsonc("[1,2,3]")).toEqual([1, 2, 3])
  })

  it("preserves URLs in strings (the bug that motivated this)", () => {
    const cfg = '{"$schema":"https://opencode.ai/config.json","plugin":["x"]}'
    expect(parseJsonc(cfg)).toEqual({ $schema: "https://opencode.ai/config.json", plugin: ["x"] })
  })
})

describe("parseJsonc: JSONC features", () => {
  it("strips line and block comments", () => {
    const src = `{
      // leading comment
      "plugin": ["a"], /* inline */ "x": 1
      /* trailing
         block */
    }`
    expect(parseJsonc(src)).toEqual({ plugin: ["a"], x: 1 })
  })

  it("removes trailing commas in objects and arrays", () => {
    expect(parseJsonc('{"plugin":["a","b",],}')).toEqual({ plugin: ["a", "b"] })
    expect(parseJsonc("[1,2,]")).toEqual([1, 2])
  })

  it("handles comments + trailing comma + URL together", () => {
    const src = `{
      "$schema": "https://opencode.ai/config.json", // schema url
      "plugin": [
        "/abs/path", // local plugin
      ],
    }`
    expect(parseJsonc(src)).toEqual({ $schema: "https://opencode.ai/config.json", plugin: ["/abs/path"] })
  })
})

describe("parseJsonc: never corrupts string contents", () => {
  it("keeps //, /*, ,] and ,} inside string values", () => {
    const src = '{"u":"a//b /* c */ , ] , }","plugin":[]}'
    expect(parseJsonc(src)).toEqual({ u: "a//b /* c */ , ] , }", plugin: [] })
  })

  it("respects escaped quotes inside strings", () => {
    expect(parseJsonc('{"q":"he said \\"hi\\" // not a comment"}')).toEqual({ q: 'he said "hi" // not a comment' })
  })
})

describe("parseJsonc: invalid input still throws", () => {
  it("throws on empty / malformed input", () => {
    expect(() => parseJsonc("")).toThrow()
    expect(() => parseJsonc("{not valid")).toThrow()
  })
})

describe("stripJsonc", () => {
  it("is a no-op-equivalent for comment-free text (still valid JSON)", () => {
    const src = '{"a":1}'
    expect(JSON.parse(stripJsonc(src))).toEqual({ a: 1 })
  })

  it("leaves a comment-looking substring inside a string intact", () => {
    expect(stripJsonc('{"u":"x//y"}')).toBe('{"u":"x//y"}')
  })
})
