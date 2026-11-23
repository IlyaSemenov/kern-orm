import { describe, expect, it } from "bun:test"

import { cutIdentifier } from "./identifier"

describe("cutIdentifier", () => {
  it("keeps a name that fits", () => {
    expect(cutIdentifier("a".repeat(50), 50)).toBe("a".repeat(50))
  })

  it("cuts a longer name", () => {
    expect(cutIdentifier("a".repeat(51), 50)).toBe("a".repeat(50))
  })

  it("counts a character other than ASCII as 4 bytes, the most it takes in a server encoding", () => {
    expect(cutIdentifier("я".repeat(12), 50)).toBe("я".repeat(12))
    expect(cutIdentifier("я".repeat(13), 50)).toBe("я".repeat(12))
  })

  it("never splits a surrogate pair", () => {
    expect(cutIdentifier("😀".repeat(13), 50)).toBe("😀".repeat(12))
  })
})
