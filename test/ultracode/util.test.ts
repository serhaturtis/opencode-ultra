import { describe, it, expect } from "vitest"
import { slugify, systemReminder, errMsg } from "../../src/util"

describe("slugify", () => {
  it("converts non-alnum to dashes and lowercases", () => {
    expect(slugify("Hello World")).toBe("hello-world")
    expect(slugify("Foo.Bar Baz!")).toBe("foo-bar-baz")
  })
  it("trims boundary dashes", () => {
    expect(slugify("-hello-")).toBe("hello")
    expect(slugify("!!!test!!!")).toBe("test")
  })
  it("caps at maxLen", () => {
    expect(slugify("a very long name here", 5)).toBe("a-ver")
  })
  it("re-trims dashes after truncation (slice can land on a dash)", () => {
    expect(slugify("hello-world-test-extra", 12)).toBe("hello-world")
  })
  it("uses fallback when slug is empty", () => {
    expect(slugify("!!!", Infinity, "fallback")).toBe("fallback")
    expect(slugify("")).toBe("agent")
  })
})

describe("systemReminder", () => {
  it("wraps lines in system-reminder tag", () => {
    const result = systemReminder("line1", "", "line3")
    expect(result).toContain("<system-reminder>")
    expect(result).toContain("</system-reminder>")
    expect(result).toBe("<system-reminder>\nline1\n\nline3\n</system-reminder>")
  })
})

describe("errMsg", () => {
  it("extracts message from Error", () => {
    expect(errMsg(new Error("boom"))).toBe("boom")
  })
  it("converts non-Error to string", () => {
    expect(errMsg(42)).toBe("42")
    expect(errMsg("plain")).toBe("plain")
    expect(errMsg(null)).toBe("null")
  })
})
