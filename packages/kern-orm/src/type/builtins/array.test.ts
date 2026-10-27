import { expect, it } from "bun:test"

import { array, parseArray } from "./array"
import { text } from "./text"

it("parses quoted, unquoted, and null elements", () => {
  expect(parseArray('{a,"b c",NULL,"NULL","q\\"x\\\\"}')).toEqual([
    "a",
    "b c",
    null,
    "NULL",
    'q"x\\',
  ])
  expect(parseArray("{}")).toEqual([])
  expect(parseArray('{""}')).toEqual([""])
  expect(parseArray('{"a}b","{c,d}"}')).toEqual(["a}b", "{c,d}"])
})

it("parses an array with a lower bound other than 1", () => {
  expect(parseArray("[0:1]={a,b}")).toEqual(["a", "b"])
})

it("encodes elements that decode back to themselves", () => {
  const texts = array(text.nullable())
  const elements = ["a", "b c", null, "NULL", 'q"x\\', ""]
  expect(texts.decode(texts.encode(elements))).toEqual(elements)
})

it("rejects multidimensional arrays", () => {
  expect(() => parseArray("{{1,2},{3,4}}")).toThrow("Multidimensional")
})

it("rejects malformed array values", () => {
  expect(() => parseArray('{"a}')).toThrow("Unterminated quoted element")
  expect(() => parseArray('{"a\\}')).toThrow("Unterminated quoted element")
  for (const text of ['{"a"b}', "{a,}", "{,a}", "{a,,b}"]) {
    expect(() => parseArray(text)).toThrow(`Malformed array value "${text}"`)
  }
})
