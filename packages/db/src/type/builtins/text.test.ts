import { expect, it } from "bun:test"

import { char, varchar } from "./text"

it("casts parameters of char to bpchar, whose length does not constrain them", () => {
  expect(char.castType).toBe("bpchar")
  expect(char.with(3).castType).toBe("bpchar")
  expect(char.with(3).sqlType).toBe("char(3)")
})

it("formats the length of varchar in its SQL type and not in its cast type", () => {
  expect(varchar.with(255).sqlType).toBe("varchar(255)")
  expect(varchar.with(255).castType).toBe("varchar")
})
