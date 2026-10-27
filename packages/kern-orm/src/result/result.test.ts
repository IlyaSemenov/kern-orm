import { describe, expect, it } from "bun:test"

import * as t from "../types"

import type { ResultField, ResultMode, ResultPlan, ResultRows } from "./result"
import { decodeResult, NotFoundError } from "./result"

const fields: ResultField[] = [
  { key: "id", type: t.integer },
  { key: "title", type: t.text },
]

/** Plan of a query of all rows as records. */
function createRecordsPlan(fields: readonly ResultField[]): ResultPlan {
  return { fields, rows: "many", value: false }
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

  it("rejects a row of another width than the result fields", () => {
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
      'Cannot decode result field "title": Driver returned no value',
    )
  })

  it("names the field whose value fails to decode and keeps the error as its cause", () => {
    const failure = new Error("not a point")
    const point = t.text.transform({
      decode: (): string => {
        throw failure
      },
    })

    let rejection: unknown
    try {
      decodeResult(createRecordsPlan([...fields, { key: "location", type: point }]), [
        ["1", "Draft", "(1,2)"],
      ])
    } catch (error) {
      rejection = error
    }

    expect(rejection).toMatchObject({
      message: 'Cannot decode result field "location": not a point',
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

    let rejection: unknown
    try {
      decodeResult(createRecordsPlan([{ key: "location", type: point }]), [["(1,2)"]])
    } catch (error) {
      rejection = error
    }

    expect(rejection).toMatchObject({
      message: 'Cannot decode result field "location"',
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
    ).toThrow('Cannot decode result field "location": not a point')
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

  it("rejects without a row of rows one, and gives null or undefined for rows nullable or optional", () => {
    expect(() => decodeResult({ ...record, fields }, [])).toThrow(NotFoundError)
    expect(() => decodeResult({ ...value, fields: [titleField] }, [])).toThrow(NotFoundError)
    expect(decodeResult({ ...record, rows: "nullable", fields }, [])).toBeNull()
    expect(decodeResult({ ...record, rows: "optional", fields }, [])).toBeUndefined()
    expect(decodeResult({ ...value, rows: "optional", fields: [titleField] }, [])).toBeUndefined()
  })

  it("rejects more than one row", () => {
    expect(() =>
      decodeResult({ ...record, rows: "optional", fields }, [
        ["1", "Draft"],
        ["2", "Final"],
      ]),
    ).toThrow("Query of one row returned 2 rows")
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
    expect(() => decodeResult(required, [[null]])).toThrow(
      'Cannot decode result field "form": Nested query of one row returned no rows',
    )
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

    let rejection: unknown
    try {
      decodeResult(plan, [['[["Name", []], ["Email", [["(1,2)"]]]]']])
    } catch (error) {
      rejection = error
    }

    expect(rejection).toMatchObject({
      message: 'Cannot decode result field "fields[1].options[0].location": not a point',
      cause: failure,
    })
  })

  it("rejects nested rows that do not match the result fields", () => {
    const plan = createRecordsPlan([nestedField("fields", [labelField], "many")])
    const rejections = [
      ['{"label": "Name"}', '"fields": Nested rows must be an array, not an object'],
      ['["Name"]', '"fields[0]": Nested row must be an array, not a string'],
      ['[["Name", "Email"]]', '"fields[0]": Nested row of 2 values for 1 result fields'],
      ["[[1]]", '"fields[0].label": Nested value must be text, not a number'],
    ]
    for (const [text, message] of rejections) {
      expect(() => decodeResult(plan, [[text!]])).toThrow(`Cannot decode result field ${message}`)
    }
    expect(() => decodeResult(plan, [["[["]])).toThrow('Cannot decode result field "fields": ')
  })
})
