import { describe, expect, it } from "bun:test"

import { cutIdentifier, nameProjection } from "./identifier"

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

describe("nameProjection", () => {
  it("names a projection by a key of up to 50 bytes", () => {
    expect(nameProjection("a".repeat(50), 2)).toBe("a".repeat(50))
  })

  it("names a projection by the prefix of a longer key and its position", () => {
    expect(nameProjection("a".repeat(64), 2)).toBe(`${"a".repeat(54)}_3`)
  })

  it("keeps more than 50 bytes of a longer key, so the name differs from every key of up to 50 bytes", () => {
    expect(nameProjection("я".repeat(16), 0)).toBe(`${"я".repeat(13)}_1`)
  })
})
