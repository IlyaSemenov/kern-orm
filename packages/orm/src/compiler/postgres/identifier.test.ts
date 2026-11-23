import { describe, expect, it } from "bun:test"

import { nameProjection } from "./identifier"

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
