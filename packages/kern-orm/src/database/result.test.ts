import { describe, expect, it } from "bun:test"

import type { ResultRows } from "./result"
import { NotFoundError, takeOnlyRow, toMissingResult } from "./result"

/** Result mode of records in rows mode `rows`. */
function createMode(rows: ResultRows) {
  return { rows, value: false }
}

describe("only row", () => {
  it("is the row of a query of one row, or undefined without it unless the rows are one", () => {
    expect(takeOnlyRow(createMode("one"), [["1"]])).toEqual(["1"])
    expect(takeOnlyRow(createMode("nullable"), [])).toBeUndefined()
    expect(takeOnlyRow(createMode("optional"), [])).toBeUndefined()
    expect(() => takeOnlyRow(createMode("one"), [])).toThrow(
      new NotFoundError("Query returned no rows"),
    )
  })

  it("rejects several rows in any rows mode of one row", () => {
    for (const rows of ["one", "nullable", "optional"] as const) {
      expect(() => takeOnlyRow(createMode(rows), [["1"], ["2"]])).toThrow(
        "Query of one row returned 2 rows",
      )
    }
  })
})

describe("missing result", () => {
  it("is null of rows nullable and undefined of rows optional", () => {
    expect(toMissingResult(createMode("nullable"))).toBeNull()
    expect(toMissingResult(createMode("optional"))).toBeUndefined()
  })
})
