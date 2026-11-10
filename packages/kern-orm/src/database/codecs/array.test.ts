import { describe, expect, it } from "bun:test"

import { array, formatArray, parseArray } from "./array"
import { text, varchar } from "./text"

describe("parseArray", () => {
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
})

describe("formatArray", () => {
  it("formats elements that parse back to themselves", () => {
    const elements = ["a", "b c", null, "NULL", 'q"x\\', "", "{c,d}"]
    expect(parseArray(formatArray(elements, element => element))).toEqual(elements)
  })
})

describe("array", () => {
  it("encodes elements that decode back to themselves", () => {
    const texts = array(text.nullable())
    const elements = ["a", "b c", null, "NULL", 'q"x\\', ""]
    expect(texts.decode(texts.encode(elements))).toEqual(elements)
  })

  it("keeps the type parameters of the element in the SQL type and not in the cast type", () => {
    expect(array(varchar.with(255)).sqlType).toBe("varchar(255)[]")
    expect(array(varchar.with(255)).castType).toBe("varchar[]")
  })
})
