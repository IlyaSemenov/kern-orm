import { expect, it } from "bun:test"

import { array } from "./array"
import { text } from "./text"

it("encodes elements that decode back to themselves", () => {
  const texts = array(text.nullable())
  const elements = ["a", "b c", null, "NULL", 'q"x\\', ""]
  expect(texts.decode(texts.encode(elements))).toEqual(elements)
})
