import { describe, expect, it } from "bun:test"

import { getThrownError } from "@kern-orm/test-harness/errors"

import type { DriverResult, TextValue } from "./driver"
import type { FlatField, FlatResultPlan, ResultRows } from "./result"
import {
  decodeFlatResult,
  NotFoundError,
  ResultDecodeError,
  takeOnlyRow,
  toMissingResult,
} from "./result"
import { integer } from "./type/builtins/numeric"
import { text } from "./type/builtins/text"
import type { AnyType } from "./type/type"

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

/** Field of a flat result of `type` read from the result column of `key`. */
function createField(key: string, type: AnyType): FlatField {
  return { key, name: key, type }
}

describe("flat results", () => {
  const fields = [createField("id", integer), createField("title", text)]

  /** Result of a statement of `rows` with `columns` whose command tag reports `count` rows. */
  function createDriverResult(
    count: number,
    rows: DriverResult["rows"] = [],
    columns: readonly string[] = [],
  ): DriverResult {
    return { command: "SELECT", count, columns: columns.map(name => ({ name, type: 25 })), rows }
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

  it("read NULL of a type that decodes it to a value as that value, in a record and as one value", () => {
    const note = text.nullableAs(() => undefined)
    const rows = [
      ["1", null],
      ["2", "x"],
    ]

    expect(
      decodeFlatResult(
        {
          fields: [createField("id", integer), createField("note", note)],
          rows: "many",
          value: false,
        },
        createDriverResult(2, rows, ["id", "note"]),
      ),
    ).toStrictEqual([
      { id: 1, note: undefined },
      { id: 2, note: "x" },
    ])
    expect(
      decodeFlatResult(
        { fields: [createField("note", note)], rows: "many", value: true },
        createDriverResult(2, [[null], ["x"]], ["note"]),
      ),
    ).toStrictEqual([undefined, "x"])
  })

  it("reject NULL of a type whose function of NULL returns a thenable, such as of an async function, in a record and as one value", () => {
    // @ts-expect-error The function returns its value synchronously.
    const note = text.nullableAs(async () => undefined)
    const cause = new TypeError(
      "The function of nullableAs() must return the value of NULL synchronously, not a Promise or a query",
    )
    const record = getThrownError(() =>
      decodeFlatResult(
        {
          fields: [createField("id", integer), createField("note", note)],
          rows: "one",
          value: false,
        },
        createDriverResult(1, [["1", null]], ["id", "note"]),
      ),
    )
    const value = getThrownError(() =>
      decodeFlatResult(
        { fields: [createField("note", note)], rows: "one", value: true },
        createDriverResult(1, [[null]], ["note"]),
      ),
    )

    expect(record).toBeInstanceOf(ResultDecodeError)
    expect(record).toMatchObject({ path: "note", cause })
    expect(value).toBeInstanceOf(ResultDecodeError)
    expect(value).toMatchObject({ cause })
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

  it.each([1, 4, 8, 16, 128])(
    "resolve %i selected fields of a wide result and ignore duplicate unselected names",
    count => {
      const columns = Array.from({ length: 128 }, (_, index) => `c${127 - index}`)
      const values = columns.map(name => name.slice(1))
      columns.push("unused", "unused")
      values.push("ignored", "ignored")
      const selected = Array.from({ length: count }, (_, index) =>
        createField(`c${Math.floor(((count - index - 1) * 128) / count)}`, integer),
      )
      const plan: FlatResultPlan = { fields: selected, rows: "many", value: false }
      const expected: Record<string, number> = {}
      for (const { key } of selected) expected[key] = Number(key.slice(1))

      expect(decodeFlatResult(plan, createDriverResult(1, [values], columns))).toEqual([expected])

      const first = selected[0]!.key
      expect(() => decodeFlatResult(plan, createDriverResult(0, [], [...columns, first]))).toThrow(
        `Statement returned column "${first}" more than once`,
      )
      expect(() =>
        decodeFlatResult(
          plan,
          createDriverResult(
            0,
            [],
            columns.filter(name => name !== first),
          ),
        ),
      ).toThrow(`Statement returned no column "${first}"`)
    },
  )

  it("report invalid columns in selection order, including when an unused column is duplicated", () => {
    const selected = Array.from({ length: 16 }, (_, index) => createField(`c${index}`, integer))
    const plan: FlatResultPlan = { fields: selected, rows: "many", value: false }
    const columns = selected.slice(2).map(field => field.key)

    expect(() =>
      decodeFlatResult(
        plan,
        createDriverResult(0, [], ["unused", "unused", "c1", ...columns, "c1"]),
      ),
    ).toThrow('Statement returned no column "c0"')
    expect(() =>
      decodeFlatResult(
        plan,
        createDriverResult(0, [], ["unused", "unused", "c0", ...columns, "c0"]),
      ),
    ).toThrow('Statement returned column "c0" more than once')
  })

  it("read a value from the only column, whatever its name, and reject other numbers of columns", () => {
    const plan: FlatResultPlan = {
      fields: [createField("value", integer)],
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
      fields: [createField("id", integer), createField("location", point)],
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

  describe("of groups", () => {
    const job = { key: "job", size: 2, presence: undefined }
    const groupFields: FlatField[] = [
      createField("lag", integer),
      { key: "id", name: "job__id", type: integer, group: job },
      { key: "title", name: "job__title", type: text, group: job },
    ]
    const columns = ["job__title", "lag", "job__id", "id"]

    /** Flat plan of records of a value and of a group whose record is `null` when the fields at `presence` are `NULL`. */
    function createGroupPlan(presence?: number[], rows: ResultRows = "many"): FlatResultPlan {
      const group = { ...job, presence }
      return {
        fields: groupFields.map(field => (field.group ? { ...field, group } : field)),
        rows,
        value: false,
      }
    }

    it("read the fields of a group from the result columns of their names into a record under the key of the group", () => {
      expect(
        decodeFlatResult(
          createGroupPlan(),
          createDriverResult(
            2,
            [
              ["Draft", "5", "1", "9"],
              [null, "6", null, "9"],
            ],
            columns,
          ),
        ),
      ).toEqual([
        { lag: 5, job: { id: 1, title: "Draft" } },
        { lag: 6, job: { id: null, title: null } },
      ])
    })

    it("read a group as null when the columns that tell its row are all NULL, without decoding the others", () => {
      const present = text.transform({
        decode: value => {
          if (value === "of a missing row") {
            throw new Error("decoded a value of a missing row")
          }
          return value
        },
      })
      const group = { ...job, presence: [0] }
      const plan: FlatResultPlan = {
        fields: [
          groupFields[0]!,
          { ...groupFields[1]!, group },
          { ...groupFields[2]!, type: present, group },
        ],
        rows: "many",
        value: false,
      }
      const rows = [
        ["Draft", "5", "1", "9"],
        ["of a missing row", "6", null, "9"],
      ]

      expect(decodeFlatResult(plan, createDriverResult(2, rows, columns))).toEqual([
        { lag: 5, job: { id: 1, title: "Draft" } },
        { lag: 6, job: null },
      ])
      expect(
        decodeFlatResult(
          createGroupPlan([0, 1]),
          createDriverResult(1, [[null, "5", null, "9"]], columns),
        ),
      ).toEqual([{ lag: 5, job: null }])
    })

    it("read NULL of a field of a group as the value that its type decodes it to, and a group without its row as null", () => {
      const group = { ...job, presence: [0] }
      const plan: FlatResultPlan = {
        fields: [
          groupFields[0]!,
          { ...groupFields[1]!, group },
          { ...groupFields[2]!, type: text.nullableAs(() => undefined), group },
        ],
        rows: "many",
        value: false,
      }
      const rows = [
        [null, "5", "1", "9"],
        [null, "6", null, "9"],
      ]

      expect(decodeFlatResult(plan, createDriverResult(2, rows, columns))).toStrictEqual([
        { lag: 5, job: { id: 1, title: undefined } },
        { lag: 6, job: null },
      ])
    })

    it("reject a group with only some of the columns that tell its row NULL, naming the group and the columns", () => {
      const error = getThrownError(() =>
        decodeFlatResult(
          createGroupPlan([0, 1]),
          createDriverResult(
            2,
            [
              ["Draft", "5", "1", "9"],
              [null, "6", "2", "9"],
            ],
            columns,
          ),
        ),
      )

      expect(error).toBeInstanceOf(ResultDecodeError)
      expect(error).toMatchObject({
        message:
          'Cannot decode result field "[1].job": Expected the result columns that tell a missing row to be all NULL or all not NULL; NULL: "job__title"; not NULL: "job__id"',
        path: "[1].job",
      })
    })

    it("name the columns that tell the row of a group by their quoted names, without the other fields of the group", () => {
      const group = { key: "job", size: 3, presence: [0, 1] }
      const plan: FlatResultPlan = {
        fields: [
          { key: "a", name: 'a", "b', type: integer, group },
          { key: "c", name: "c", type: integer, group },
          { key: "d", name: "d", type: integer, group },
        ],
        rows: "many",
        value: false,
      }

      const error = getThrownError(() =>
        decodeFlatResult(plan, createDriverResult(1, [["1", null, null]], ['a", "b', "c", "d"])),
      )

      expect(error).toMatchObject({
        message:
          'Cannot decode result field "[0].job": Expected the result columns that tell a missing row to be all NULL or all not NULL; NULL: "c"; not NULL: "a"", ""b"',
      })
    })

    it("reject a column that tells the row of a group without a value of the driver beside a NULL one as a field without a value", () => {
      const error = getThrownError(() =>
        decodeFlatResult(
          createGroupPlan([0, 1]),
          // A sparse row of all the columns, with the title NULL and without the value of the id.
          createDriverResult(
            1,
            [Object.assign(new Array<TextValue>(4), { 0: null, 1: "5", 3: "9" })],
            columns,
          ),
        ),
      )

      expect(error).toMatchObject({
        message: 'Cannot decode result field "[0].job.id": Driver returned no value',
      })
    })

    it("resolve the fields of a wide group by the names of their result columns, in another order than the result", () => {
      const wide = { key: "job", size: 21, presence: undefined }
      const fields: FlatField[] = Array.from({ length: 21 }, (_, index) => ({
        key: `c${index}`,
        name: `j__c${index}`,
        type: integer,
        group: wide,
      }))
      // The names of the keys are other columns of the result, which the group must not read.
      const names = fields.flatMap(field => [field.key, field.name]).toReversed()
      const values = names.map(name => (name.startsWith("j__") ? name.slice(4) : "-1"))
      const record: Record<string, number> = {}
      for (let index = 0; index < 21; index++) record[`c${index}`] = index

      expect(
        decodeFlatResult(
          { fields, rows: "many", value: false },
          createDriverResult(1, [values], names),
        ),
      ).toEqual([{ job: record }])
      expect(() =>
        decodeFlatResult(
          { fields, rows: "many", value: false },
          createDriverResult(0, [], [...names, "j__c7"]),
        ),
      ).toThrow('Statement returned column "j__c7" more than once')
    })

    it("reject without a column of a field of a group or with it twice, by the name of the column", () => {
      expect(() =>
        decodeFlatResult(createGroupPlan(), createDriverResult(0, [], ["lag", "id", "job__title"])),
      ).toThrow('Statement returned no column "job__id"')
      expect(() =>
        decodeFlatResult(createGroupPlan(), createDriverResult(0, [], [...columns, "job__id"])),
      ).toThrow('Statement returned column "job__id" more than once')
    })

    it("name the group and the field whose value fails to decode", () => {
      const failure = new Error("not a number")
      const failing = integer.transform({
        decode: (): number => {
          throw failure
        },
      })
      const plan: FlatResultPlan = {
        fields: [
          groupFields[0]!,
          groupFields[1]!,
          { key: "title", name: "job__title", type: failing, group: job },
        ],
        rows: "one",
        value: false,
      }

      expect(
        getThrownError(() =>
          decodeFlatResult(plan, createDriverResult(1, [["Draft", "5", "1", "9"]], columns)),
        ),
      ).toMatchObject({
        message: 'Cannot decode result field "job.title": not a number',
        path: "job.title",
        cause: failure,
      })
    })
  })

  it("reject a row of the driver of another width than the result columns, without a path", () => {
    const value: FlatResultPlan = {
      fields: [createField("value", integer)],
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
