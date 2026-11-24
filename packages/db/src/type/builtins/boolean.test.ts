import { expect, it } from "bun:test"

import { getThrownError } from "@kern-orm/test-harness/errors"

import { boolean } from "./boolean"

it("decodes t and f", () => {
  expect(boolean.decode("t")).toBe(true)
  expect(boolean.decode("f")).toBe(false)
})

it("rejects text other than t and f", () => {
  for (const text of ["true", "false", "1", "0", "", "T", "t "]) {
    expect(getThrownError(() => boolean.decode(text))).toEqual(
      new Error(`Unsupported boolean value "${text}"`),
    )
  }
})
