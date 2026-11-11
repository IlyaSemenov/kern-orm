import { describe, expect, it } from "bun:test"

import { getThrownError } from "@kern-orm/test-harness/errors"

import type { DriverResult } from "./driver"
import type { FlatResultPlan, ResultRows } from "./result"
import {
  decodeFlatResult,
  NotFoundError,
  ResultDecodeError,
  takeOnlyRow,
  toMissingResult,
} from "./result"
import { integer } from "./type/builtins/numeric"
import { text } from "./type/builtins/text"

/** Result mode of records in rows mode `rows`. */
function createMode(rows: ResultRows) {
  return { rows, value: false }
}

describe("only row", () => {
  it("is the row of a query of one row, or undefined without it unless the rows are one", () => {
    expect(takeOnlyRow(createMode("one"), [["1"]])).toEqual(["1"])
    expect(takeOnlyRow(createMode("nullable"), [])).toBeUndefined()
    expect(takeOnlyRow(createMode("optional"), [])).toBeUndefined()
    expect(getThrownError(() => takeOnlyRow(createMode("one"), []))).toEqual(
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

describe("flat results", () => {
  const fields = [
    { key: "id", type: integer },
    { key: "title", type: text },
  ]

  /** Result of a statement of `rows` with `columns` whose command tag reports `count` rows. */
  function createDriverResult(
    count: number,
    rows: DriverResult["rows"] = [],
    columns: readonly string[] = [],
  ): DriverResult {
    return { command: "SELECT", count, columns, rows }
  }

  /** Flat plan of records of `fields` in rows mode `rows`. */
  function createRecordsPlan(rows: ResultRows = "many"): FlatResultPlan {
    return { fields, rows, value: false }
  }

  it("read the fields of records from the result columns of their keys, keeping NULL as null and ignoring other columns", () => {
    const rows = [
      ["Draft", "x", "1"],
      [null, "y", "2"],
    ]

    expect(
      decodeFlatResult(createRecordsPlan(), createDriverResult(2, rows, ["title", "note", "id"])),
    ).toEqual([
      { id: 1, title: "Draft" },
      { id: 2, title: null },
    ])
    expect(
      decodeFlatResult(
        createRecordsPlan("one"),
        createDriverResult(1, [["1", "Draft"]], ["id", "title"]),
      ),
    ).toEqual({ id: 1, title: "Draft" })
  })

  it("reject without a column of a field or with it twice", () => {
    const missing = getThrownError(() =>
      decodeFlatResult(createRecordsPlan(), createDriverResult(0, [], ["id", "name"])),
    )

    expect(missing).toBeInstanceOf(ResultDecodeError)
    expect(missing).toHaveProperty("message", 'Statement returned no column "title"')
    expect(() =>
      decodeFlatResult(createRecordsPlan(), createDriverResult(0, [], ["id", "title", "id"])),
    ).toThrow('Statement returned column "id" more than once')
  })

  it("read a value from the only column, whatever its name, and reject other numbers of columns", () => {
    const plan: FlatResultPlan = {
      fields: [{ key: "value", type: integer }],
      rows: "many",
      value: true,
    }

    expect(decodeFlatResult(plan, createDriverResult(2, [["1"], ["2"]], ["count"]))).toEqual([1, 2])
    expect(() =>
      decodeFlatResult(plan, createDriverResult(1, [["1", "2"]], ["id", "count"])),
    ).toThrow("Statement returned 2 columns for one value")
  })

  it("take the only row of a query of one row, as its rows mode tells", () => {
    const columns = ["id", "title"]

    expect(
      decodeFlatResult(createRecordsPlan("nullable"), createDriverResult(0, [], columns)),
    ).toBeNull()
    expect(() =>
      decodeFlatResult(createRecordsPlan("one"), createDriverResult(0, [], columns)),
    ).toThrow(NotFoundError)
    expect(() =>
      decodeFlatResult(
        createRecordsPlan("optional"),
        createDriverResult(
          2,
          [
            ["1", "Draft"],
            ["2", "Final"],
          ],
          columns,
        ),
      ),
    ).toThrow("Query of one row returned 2 rows")
  })

  it("name the row and the field whose value fails to decode, or the field alone of a query of one row, and keep the error as the cause", () => {
    const failure = new Error("not a point")
    const point = text.transform({
      decode: (): string => {
        throw failure
      },
    })
    const plan: FlatResultPlan = {
      fields: [
        { key: "id", type: integer },
        { key: "location", type: point },
      ],
      rows: "many",
      value: false,
    }
    const columns = ["id", "location"]
    const many = getThrownError(() =>
      decodeFlatResult(
        plan,
        createDriverResult(
          2,
          [
            ["1", null],
            ["2", "(1,2)"],
          ],
          columns,
        ),
      ),
    )
    const one = getThrownError(() =>
      decodeFlatResult({ ...plan, rows: "one" }, createDriverResult(1, [["1", "(1,2)"]], columns)),
    )

    expect(many).toBeInstanceOf(ResultDecodeError)
    expect(many).toMatchObject({
      message: 'Cannot decode result field "[1].location": not a point',
      path: "[1].location",
      cause: failure,
    })
    expect(one).toMatchObject({
      message: 'Cannot decode result field "location": not a point',
      path: "location",
    })
  })

  it("reject a row of the driver of another width than the result columns, without a path", () => {
    const value: FlatResultPlan = {
      fields: [{ key: "value", type: integer }],
      rows: "many",
      value: true,
    }

    for (const [plan, rows, columns] of [
      [value, [["1", "2"]], ["count"]],
      [value, [[]], ["count"]],
      [createRecordsPlan(), [["1", "Draft"]], ["id", "title", "note"]],
    ] as const) {
      expect(
        getThrownError(() => decodeFlatResult(plan, createDriverResult(1, rows, columns))),
      ).toMatchObject({
        message: `Driver returned a row of ${rows[0].length} values for ${columns.length} columns`,
        path: undefined,
      })
    }
  })

  it("resolve to the number of the rows of the command tag without fields, rejecting it as a query of one row rejects its rows", () => {
    const plan: FlatResultPlan = { fields: undefined, rows: "many", value: false }

    expect(decodeFlatResult(plan, createDriverResult(3))).toBe(3)
    expect(decodeFlatResult({ ...plan, rows: "one" }, createDriverResult(1))).toBe(1)
    expect(decodeFlatResult({ ...plan, rows: "optional" }, createDriverResult(0))).toBe(0)
    expect(
      getThrownError(() => decodeFlatResult({ ...plan, rows: "one" }, createDriverResult(0))),
    ).toEqual(new NotFoundError("Query reported no rows"))
    expect(() => decodeFlatResult({ ...plan, rows: "nullable" }, createDriverResult(2))).toThrow(
      "Query of one row reported 2 rows",
    )
  })
})
