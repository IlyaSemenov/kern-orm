import { expect, it } from "bun:test"

import { numeric } from "./numeric"

it("formats the precision and the optional scale of numeric in its SQL type and not in its cast type", () => {
  expect(numeric.with(10, 2).sqlType).toBe("numeric(10,2)")
  expect(numeric.with(10).sqlType).toBe("numeric(10)")
  expect(numeric.with(10, 2).castType).toBe("numeric")
})
