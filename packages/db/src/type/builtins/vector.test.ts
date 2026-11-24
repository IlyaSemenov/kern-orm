import { expect, it } from "bun:test"

import { getThrownError } from "@kern-orm/test-harness/errors"

import { vector } from "./vector"

it("formats the dimensions of vector in its SQL type and not in its cast type", () => {
  expect(vector.with(3).sqlType).toBe("vector(3)")
  expect(vector.with(3).castType).toBe("vector")
})

it("converts vectors to and from their text representation", () => {
  expect(vector.encode([1, 2.5, -0.00001])).toBe("[1,2.5,-0.00001]")
  expect(vector.encode([])).toBe("[]")
  expect(vector.decode("[1,2.5,1e-05,-3e+20]")).toEqual([1, 2.5, 0.00001, -3e20])
})

it("rejects JSON other than an array", () => {
  expect(() => vector.decode("[1,")).toThrow(SyntaxError)
  for (const text of ["5", "null", '"[1]"', "{}"]) {
    expect(getThrownError(() => vector.decode(text))).toEqual(
      new Error("Unsupported vector value: it is not an array"),
    )
  }
})
