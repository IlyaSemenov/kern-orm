import { expect, it } from "bun:test"

import { enumOf } from "./enum"

it("takes a name with parentheses, such as a quoted one, as the cast type", () => {
  expect(enumOf('"status(v2)"', ["draft"]).castType).toBe('"status(v2)"')
})
