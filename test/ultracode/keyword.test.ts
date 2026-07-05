import { describe, it, expect } from "vitest"
import { textFromParts, isUltracodeKeyword } from "../../src/ultracode/keyword"

describe("textFromParts", () => {
  it("extracts text from parts array", () => {
    expect(textFromParts([{ type: "text", text: "hello" }])).toBe("hello")
  })
  it("returns empty string for undefined parts", () => {
    expect(textFromParts(undefined)).toBe("")
  })
  it("skips non-text parts", () => {
    expect(textFromParts([{ type: "image" }])).toBe("")
  })
  it("handles empty array", () => {
    expect(textFromParts([])).toBe("")
  })
  it("handles parts with no text field", () => {
    expect(textFromParts([{ type: "text" }])).toBe("")
  })
})

describe("isUltracodeKeyword", () => {
  it("matches ultracode: prefix", () => {
    expect(isUltracodeKeyword("ultracode: do stuff")).toBe(true)
  })
  it("does not match unrelated text", () => {
    expect(isUltracodeKeyword("hello world")).toBe(false)
  })
  it("does not match ultracode without colon", () => {
    expect(isUltracodeKeyword("ultracode is cool")).toBe(false)
  })
})
