import { expect, it } from "bun:test"

import { char } from "./text"

it("casts parameters of char to bpchar, whose length does not constrain them", () => {
  expect(char.castType).toBe("bpchar")
  expect(char.with(3).castType).toBe("bpchar")
  expect(char.with(3).sqlType).toBe("char(3)")
})
