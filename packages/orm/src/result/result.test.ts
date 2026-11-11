import { describe, expect, it } from "bun:test"

import type { DriverResult, ResultRows } from "kern-db"
import { NotFoundError, ResultDecodeError } from "kern-db"
import type { ResultMode } from "kern-db/builder"

import * as t from "../types"

import type { ResultConversion, ResultField, ResultPlan, StatementPlan } from "./result"
import { decodeResult, decodeStatement, RequiredRelationError } from "./result"

const fields: ResultField[] = [
  { key: "id", type: t.integer },
  { key: "title", type: t.text },
]

/** Plan of a query of all rows as records. */
function createRecordsPlan(fields: readonly ResultField[]): ResultPlan {
  return { fields, rows: "many", value: false }
}

/** Returns the error that `decode` throws, or `undefined` when it returns. */
function captureError(decode: () => unknown): unknown {
  try {
    decode()
  } catch (error) {
    return error
  }
  return undefined
}

describe("records", () => {
  it("decodes rows into records, keeping NULL as null", () => {
    expect(
      decodeResult(createRecordsPlan(fields), [
        ["1", "Draft"],
        ["2", null],
      ]),
    ).toEqual([
      { id: 1, title: "Draft" },
      { id: 2, title: null },
    ])
  })

  it("keeps a field whose decoder returns undefined", () => {
    const missing = t.text.transform({ decode: () => undefined })

    expect(decodeResult(createRecordsPlan([{ key: "id", type: missing }]), [["1"]])).toStrictEqual([
      { id: undefined },
    ])
  })

  it("starts a record from the template of the plan, keeping its keys in order and its values as they are", () => {
    const value = { nested: true }
    const [record] = decodeResult(
      {
        ...createRecordsPlan(fields),
        recordTemplate: [
          { key: "before", value },
          { key: "id", value: undefined },
          { key: "after", value: undefined },
          { key: "title", value: undefined },
        ],
      },
      [["1", "Draft"]],
    ) as [Record<string, unknown>]

    expect(record).toStrictEqual({ before: value, id: 1, after: undefined, title: "Draft" })
    expect(record.before).toBe(value)
    expect(Object.keys(record)).toEqual(["before", "id", "after", "title"])
  })

  it("does not count the fields of the template in the width of a row", () => {
    expect(
      decodeResult({ ...createRecordsPlan([]), recordTemplate: [{ key: "note", value: "none" }] }, [
        [],
        [],
      ]),
    ).toEqual([{ note: "none" }, { note: "none" }])
    expect(() =>
      decodeResult({ ...createRecordsPlan([]), recordTemplate: [{ key: "note", value: "none" }] }, [
        ["none"],
      ]),
    ).toThrow(ResultDecodeError)
  })

  it("rejects a row of another width than the result fields", () => {
    expect(() => decodeResult(createRecordsPlan(fields), [["1"]])).toThrow(ResultDecodeError)
    expect(() => decodeResult(createRecordsPlan(fields), [["1"]])).toThrow(
      "Driver returned a row of 1 values for 2 result fields",
    )
    expect(() => decodeResult(createRecordsPlan(fields), [["1", "Draft", "extra"]])).toThrow(
      "Driver returned a row of 3 values for 2 result fields",
    )
  })

  it("rejects a missing value in a row of the right width", () => {
    const row = Array.from<string | null>({ length: 2 })
    row[0] = "1"

    expect(() => decodeResult(createRecordsPlan(fields), [row])).toThrow(
      'Cannot decode result field "[0].title": Driver returned no value',
    )
  })

  it("names the row and the field whose value fails to decode and keeps the error as its cause", () => {
    const failure = new Error("not a point")
    const point = t.text.transform({
      decode: (): string => {
        throw failure
      },
    })

    const rejection = captureError(() =>
      decodeResult(createRecordsPlan([...fields, { key: "location", type: point }]), [
        ["1", "Draft", null],
        ["2", "Final", "(1,2)"],
      ]),
    )

    expect(rejection).toBeInstanceOf(ResultDecodeError)
    expect(rejection).toMatchObject({
      message: 'Cannot decode result field "[1].location": not a point',
      path: "[1].location",
      cause: failure,
    })
  })

  it("keeps a thrown value that is not an Error as the cause", () => {
    const failure: unknown = Object.create(null)
    const point = t.text.transform({
      decode: (): string => {
        throw failure
      },
    })

    expect(
      captureError(() =>
        decodeResult(createRecordsPlan([{ key: "location", type: point }]), [["(1,2)"]]),
      ),
    ).toMatchObject({
      message: 'Cannot decode result field "[0].location"',
      cause: failure,
    })
  })
})

describe("values", () => {
  const titleField: ResultField = { key: "title", type: t.text }

  it("decodes rows into the values of their only field, keeping NULL as null", () => {
    expect(
      decodeResult({ fields: [titleField], rows: "many", value: true }, [["Draft"], [null]]),
    ).toEqual(["Draft", null])
    expect(decodeResult({ fields: [titleField], rows: "many", value: true }, [])).toEqual([])
  })

  it("rejects a value that does not match its field", () => {
    const point = t.text.transform({
      decode: (): string => {
        throw new Error("not a point")
      },
    })

    expect(() =>
      decodeResult({ fields: [titleField], rows: "many", value: true }, [["Draft", "extra"]]),
    ).toThrow("Driver returned a row of 2 values for 1 result fields")
    expect(() =>
      decodeResult({ fields: [{ key: "location", type: point }], rows: "many", value: true }, [
        ["(1,2)"],
      ]),
    ).toThrow('Cannot decode result field "[0].location": not a point')
  })
})

describe("one row", () => {
  const record: ResultMode = { rows: "one", value: false }
  const value: ResultMode = { rows: "one", value: true }
  const titleField: ResultField = { key: "title", type: t.text }

  it("decodes the row into a record or the value of its only field", () => {
    expect(decodeResult({ ...record, fields }, [["1", "Draft"]])).toEqual({ id: 1, title: "Draft" })
    expect(decodeResult({ ...value, fields: [{ key: "id", type: t.integer }] }, [["1"]])).toBe(1)
    expect(decodeResult({ ...value, fields: [titleField] }, [[null]])).toBeNull()
  })

  it("rejects without a row of rows one and with several rows, and gives null or undefined for rows nullable or optional", () => {
    expect(() => decodeResult({ ...record, fields }, [])).toThrow(NotFoundError)
    expect(() => decodeResult({ ...value, fields: [titleField] }, [])).toThrow(NotFoundError)
    expect(decodeResult({ ...record, rows: "nullable", fields }, [])).toBeNull()
    expect(decodeResult({ ...record, rows: "optional", fields }, [])).toBeUndefined()
    expect(decodeResult({ ...value, rows: "optional", fields: [titleField] }, [])).toBeUndefined()
    expect(() =>
      decodeResult({ ...record, rows: "optional", fields }, [
        ["1", "Draft"],
        ["2", "Final"],
      ]),
    ).toThrow("Query of one row returned 2 rows")
  })

  it("names the field whose value fails to decode without the index of the row", () => {
    const point = t.text.transform({
      decode: (): string => {
        throw new Error("not a point")
      },
    })

    expect(
      captureError(() =>
        decodeResult({ ...value, fields: [{ key: "location", type: point }] }, [["(1,2)"]]),
      ),
    ).toMatchObject({
      message: 'Cannot decode result field "location": not a point',
      path: "location",
    })
  })
})

describe("nested rows", () => {
  const labelField: ResultField = { key: "label", type: t.text }
  /** Field of nested records of `fields` in rows mode `rows`. */
  function nestedField(key: string, fields: readonly ResultField[], rows: ResultRows): ResultField {
    return { key, nested: { fields, rows, value: false } }
  }

  it("decodes an array of nested records from the JSON text of their field", () => {
    const plan = createRecordsPlan([
      { key: "name", type: t.text },
      nestedField("fields", [labelField, { key: "position", type: t.integer }], "many"),
    ])

    expect(
      decodeResult(plan, [
        ["Survey", '[["Name", "1"], [null, "2"]]'],
        ["Empty", "[]"],
      ]),
    ).toEqual([
      {
        name: "Survey",
        fields: [
          { label: "Name", position: 1 },
          { label: null, position: 2 },
        ],
      },
      { name: "Empty", fields: [] },
    ])
  })

  it("decodes a nested record of one row, rejecting without it unless it is nullable or optional", () => {
    const nullable = createRecordsPlan([nestedField("form", [labelField], "nullable")])
    const optional = createRecordsPlan([nestedField("form", [labelField], "optional")])
    const required = createRecordsPlan([nestedField("form", [labelField], "one")])

    expect(decodeResult(nullable, [['["Survey"]'], [null]])).toEqual([
      { form: { label: "Survey" } },
      { form: null },
    ])
    const [missing] = decodeResult(optional, [[null]]) as [Record<string, unknown>]
    expect(missing).toHaveProperty("form", undefined)
    expect(decodeResult(required, [['["Survey"]']])).toEqual([{ form: { label: "Survey" } }])
    expect(() => decodeResult(required, [[null]])).toThrow(NotFoundError)
    expect(() => decodeResult(required, [[null]])).toThrow(
      'Nested query of result field "[0].form" returned no rows',
    )
  })

  it("rejects a missing nested row with its path at any depth, naming the required relation that guarantees it", () => {
    const form: ResultField = {
      key: "form",
      nested: { fields: [labelField], rows: "one", value: false, guaranteedBy: "field.form" },
    }
    const plan = createRecordsPlan([
      nestedField("fields", [labelField, nestedField("first", [labelField], "one")], "many"),
      nestedField("options", [form], "many"),
    ])

    const notFound = captureError(() =>
      decodeResult(plan, [['[["Name", ["Survey"]], ["Email", null]]', "[]"]]),
    )
    const brokenRelation = captureError(() =>
      decodeResult(plan, [["[]", '[[["Survey"]], [null]]']]),
    )

    expect(notFound).toBeInstanceOf(NotFoundError)
    expect(notFound).toMatchObject({
      message: 'Nested query of result field "[0].fields[1].first" returned no rows',
      path: "[0].fields[1].first",
    })
    expect(brokenRelation).toBeInstanceOf(RequiredRelationError)
    expect(brokenRelation).toMatchObject({
      message:
        'Required relation "field.form" has no record for result field "[0].options[1].form"',
      relation: "field.form",
      path: "[0].options[1].form",
    })
  })

  it("tells a missing nested row from a NULL value of it", () => {
    const label: ResultField = {
      key: "label",
      nested: { fields: [labelField], rows: "optional", value: true },
    }
    const plan = createRecordsPlan([label, nestedField("fields", [label], "many")])

    expect(decodeResult(plan, [[null, '[[null], [[null]], [["Name"]]]']])).toEqual([
      { label: undefined, fields: [{ label: undefined }, { label: null }, { label: "Name" }] },
    ])
  })

  it("decodes nested values, records without fields, and rows nested in them", () => {
    const labels: ResultField = {
      key: "labels",
      nested: { fields: [labelField], rows: "many", value: true },
    }
    const plan = createRecordsPlan([
      labels,
      nestedField("fields", [labelField, labels], "many"),
      nestedField("rows", [], "many"),
    ])

    expect(
      decodeResult(plan, [['[["Name"], [null]]', '[["Name", [["First"], ["Last"]]]]', "[[], []]"]]),
    ).toEqual([
      {
        labels: ["Name", null],
        fields: [{ label: "Name", labels: ["First", "Last"] }],
        rows: [{}, {}],
      },
    ])
  })

  it("names the path of a nested value that fails to decode and keeps its error as the cause", () => {
    const failure = new Error("not a point")
    const point = t.text.transform({
      decode: (): string => {
        throw failure
      },
    })
    const plan = createRecordsPlan([
      nestedField(
        "fields",
        [labelField, nestedField("options", [{ key: "location", type: point }], "many")],
        "many",
      ),
    ])

    const rejection = captureError(() =>
      decodeResult(plan, [['[["Name", []], ["Email", [["(1,2)"]]]]']]),
    )

    expect(rejection).toBeInstanceOf(ResultDecodeError)
    expect(rejection).toMatchObject({
      message: 'Cannot decode result field "[0].fields[1].options[0].location": not a point',
      path: "[0].fields[1].options[0].location",
      cause: failure,
    })
  })

  it("rejects nested rows that do not match the result fields", () => {
    const plan = createRecordsPlan([nestedField("fields", [labelField], "many")])
    const rejections = [
      ['{"label": "Name"}', '"[0].fields": Nested rows must be an array, not an object'],
      ['["Name"]', '"[0].fields[0]": Nested row must be an array, not a string'],
      ['[["Name", "Email"]]', '"[0].fields[0]": Nested row of 2 values for 1 result fields'],
      ["[[1]]", '"[0].fields[0].label": Nested value must be text, not a number'],
    ]
    for (const [text, message] of rejections) {
      expect(() => decodeResult(plan, [[text!]])).toThrow(`Cannot decode result field ${message}`)
    }
    expect(() => decodeResult(plan, [["[["]])).toThrow('Cannot decode result field "[0].fields": ')
  })
})

describe("conversion", () => {
  const value: ResultField[] = [{ key: "value", type: t.integer }]

  /** Plan of `rows` of one integer value, converted by `conversion`. */
  function createValuePlan(rows: ResultRows, conversion: Partial<ResultConversion>): ResultPlan {
    return {
      fields: value,
      rows,
      value: true,
      conversion: { map: undefined, transform: undefined, ...conversion },
    }
  }

  /** Field of the nested rows of `plan`, of which a row of the driver holds the JSON. */
  function createNestedPlan(plan: ResultPlan): ResultPlan {
    return { fields: [{ key: "items", nested: plan }], rows: "one", value: false }
  }

  const increment = (row: unknown) => (row as number) + 1
  const count = (result: unknown) => (result as readonly unknown[]).length
  const failOnCall = (): never => {
    throw new Error("Unexpected call")
  }

  it("maps each row, and transforms the whole result after it", () => {
    expect(decodeResult(createValuePlan("many", { map: increment }), [["1"], ["2"]])).toEqual([
      2, 3,
    ])
    expect(decodeResult(createValuePlan("many", { transform: count }), [["1"], ["2"]])).toBe(2)
    expect(decodeResult(createValuePlan("one", { map: increment }), [["1"]])).toBe(2)
    expect(
      decodeResult(createValuePlan("many", { map: increment, transform: result => [result] }), [
        ["1"],
      ]),
    ).toEqual([[2]])
  })

  it("does not map a missing row, and transforms its result", () => {
    for (const rows of ["optional", "nullable"] as const) {
      const missing = rows === "optional" ? undefined : null

      expect(decodeResult(createValuePlan(rows, { map: failOnCall }), [])).toBe(missing)
      expect(
        decodeResult(createValuePlan(rows, { map: failOnCall, transform: result => [result] }), []),
      ).toEqual([missing])
    }
  })

  it("maps a row that decodes to null or undefined, which is not a missing row", () => {
    const describeValue = (row: unknown) => `value ${String(row)}`
    const plan = createValuePlan("optional", { map: describeValue })
    const empty: ResultField[] = [
      { key: "value", type: t.text.transform({ decode: () => undefined }) },
    ]

    expect(decodeResult(plan, [[null]])).toBe("value null")
    expect(decodeResult({ ...plan, fields: empty }, [["text"]])).toBe("value undefined")
    expect(decodeResult(createValuePlan("many", { map: describeValue }), [[null]])).toEqual([
      "value null",
    ])
  })

  it("rejects a missing row of rows one before it converts", () => {
    expect(() =>
      decodeResult(createValuePlan("one", { map: failOnCall, transform: failOnCall }), []),
    ).toThrow(new NotFoundError("Query returned no rows"))
  })

  it("converts nested rows, whose missing row it tells by their JSON", () => {
    const decodeNested = (plan: ResultPlan, json: string | null) =>
      decodeResult(createNestedPlan(plan), [[json]])

    expect(decodeNested(createValuePlan("many", { map: increment }), '[["1"],["2"]]')).toEqual({
      items: [2, 3],
    })
    expect(decodeNested(createValuePlan("many", { transform: count }), "[]")).toEqual({ items: 0 })
    expect(decodeNested(createValuePlan("one", { map: increment }), '["1"]')).toEqual({ items: 2 })
    expect(decodeNested(createValuePlan("optional", { map: increment }), null)).toStrictEqual({
      items: undefined,
    })
    expect(decodeNested(createValuePlan("nullable", { transform: () => "none" }), null)).toEqual({
      items: "none",
    })
    expect(
      decodeNested(createValuePlan("optional", { map: row => `value ${String(row)}` }), "[null]"),
    ).toEqual({ items: "value null" })
    expect(() => decodeNested(createValuePlan("one", { map: failOnCall }), null)).toThrow(
      NotFoundError,
    )
  })

  describe("failures", () => {
    const failure = new RangeError("Out of range")
    const fail = (): never => {
      throw failure
    }
    const failOnSecond = (row: unknown): unknown => {
      if (row === 2) {
        throw failure
      }
      return row
    }

    /** Returns the `ResultDecodeError` that decoding by `plan` rejects with, checking its cause. */
    function captureDecodeError(plan: ResultPlan, rows: readonly (readonly string[])[]) {
      const error = captureError(() => decodeResult(plan, rows)) as ResultDecodeError
      expect(error).toBeInstanceOf(ResultDecodeError)
      expect(error.cause).toBe(failure)
      return error
    }

    it("names the index of a row of an executed query that map fails on", () => {
      const error = captureDecodeError(createValuePlan("many", { map: failOnSecond }), [
        ["1"],
        ["2"],
      ])

      expect(error.path).toBe("[1]")
      expect(error.message).toBe('Cannot decode result field "[1]": Out of range')
    })

    it("has no path for the only row and the whole result of an executed query", () => {
      for (const plan of [
        createValuePlan("one", { map: fail }),
        createValuePlan("one", { transform: fail }),
        createValuePlan("many", { transform: fail }),
      ]) {
        const error = captureDecodeError(plan, [["1"]])

        expect(error.path).toBeUndefined()
        expect(error.message).toBe("Cannot convert the result: Out of range")
      }
    })

    it("names the field of nested rows that a conversion fails on, with the index of a row of map", () => {
      const nested = createNestedPlan(createValuePlan("many", { map: failOnSecond }))
      expect(captureDecodeError(nested, [['[["1"],["2"]]']]).path).toBe("items[1]")

      const transformed = createNestedPlan(createValuePlan("many", { transform: fail }))
      expect(captureDecodeError(transformed, [["[]"]]).path).toBe("items")

      const mapped = createNestedPlan(createValuePlan("one", { map: fail }))
      expect(captureDecodeError(mapped, [['["1"]']]).path).toBe("items")

      const deep = createNestedPlan({
        fields: [{ key: "children", nested: createValuePlan("many", { map: failOnSecond }) }],
        rows: "many",
        value: false,
      })
      expect(captureDecodeError(deep, [['[[[["1"]]],[[["2"]]]]']]).path).toBe(
        "items[1].children[0]",
      )
    })

    it("adds the index of the row of an executed query before the field", () => {
      const plan: ResultPlan = {
        fields: [{ key: "items", nested: createValuePlan("many", { transform: fail }) }],
        rows: "many",
        value: false,
      }

      expect(captureDecodeError(plan, [["[]"]]).path).toBe("[0].items")
    })

    it("does not describe a thrown value other than an Error", () => {
      const error = captureError(() =>
        decodeResult(
          createValuePlan("one", {
            map: () => {
              // oxlint-disable-next-line no-throw-literal -- a callback may throw anything
              throw "failure"
            },
          }),
          [["1"]],
        ),
      ) as ResultDecodeError

      expect(error.message).toBe("Cannot convert the result")
      expect(error.cause).toBe("failure")
    })
  })
})

describe("statements", () => {
  /** Result of a statement of `rows` whose command tag reports `count` rows. */
  function createDriverResult(count: number, rows: DriverResult["rows"] = []): DriverResult {
    return { command: "UPDATE", count, columns: [], rows }
  }

  it("decodes the rows of a statement whose rows are its result", () => {
    const plan: StatementPlan = { ...createRecordsPlan(fields), counted: undefined }

    expect(decodeStatement(plan, createDriverResult(1, [["1", "Draft"]]))).toEqual([
      { id: 1, title: "Draft" },
    ])
  })

  it("resolves to the number of the rows that a mutation changes", () => {
    const plan: StatementPlan = {
      fields: [],
      rows: "many",
      value: false,
      counted: "number",
    }

    expect(decodeStatement(plan, createDriverResult(3))).toBe(3)
    expect(decodeStatement(plan, createDriverResult(0))).toBe(0)
  })

  it("rejects without the row of a mutation of one row unless it is optional or nullable, and with several rows", () => {
    const plan: StatementPlan = {
      fields: [],
      rows: "one",
      value: false,
      counted: "number",
    }

    expect(decodeStatement(plan, createDriverResult(1))).toBe(1)
    expect(() => decodeStatement(plan, createDriverResult(0))).toThrow(NotFoundError)
    expect(() => decodeStatement(plan, createDriverResult(0))).toThrow(
      "Query found no row to change",
    )
    expect(() => decodeStatement(plan, createDriverResult(2))).toThrow(
      "Query of one row changed 2 rows",
    )
    for (const rows of ["optional", "nullable"] as const) {
      expect(decodeStatement({ ...plan, rows }, createDriverResult(0))).toBe(0)
      expect(() => decodeStatement({ ...plan, rows }, createDriverResult(2))).toThrow(
        "Query of one row changed 2 rows",
      )
    }
  })

  it("resolves to as many records without fields as a mutation changes rows, in its rows mode", () => {
    const plan: StatementPlan = {
      fields: [],
      rows: "many",
      value: false,
      counted: "records",
    }

    expect(decodeStatement(plan, createDriverResult(2))).toEqual([{}, {}])
    expect(decodeStatement(plan, createDriverResult(0))).toEqual([])
    expect(decodeStatement({ ...plan, rows: "one" }, createDriverResult(1))).toEqual({})
    expect(() => decodeStatement({ ...plan, rows: "one" }, createDriverResult(0))).toThrow(
      "Query found no row to change",
    )
    expect(() => decodeStatement({ ...plan, rows: "optional" }, createDriverResult(2))).toThrow(
      "Query of one row changed 2 rows",
    )
    expect(decodeStatement({ ...plan, rows: "optional" }, createDriverResult(0))).toBeUndefined()
    expect(decodeStatement({ ...plan, rows: "nullable" }, createDriverResult(0))).toBeNull()
  })
})
