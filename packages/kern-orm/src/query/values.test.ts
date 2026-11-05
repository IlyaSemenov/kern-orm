import { describe, expect, it } from "bun:test"

import type { ParamNode } from "../ast/nodes"
import { createRef } from "../ast/testing"
import { toNode } from "../expression/expression"
import { sql } from "../expression/sql"
import { defineTable } from "../table/table"
import type { AnyType } from "../type/type"
import * as t from "../types"

import { from } from "./select"
import { toAssignments, toInsertRows } from "./values"

const form = defineTable("form", {
  id: t.uuid.primaryKey().hasDefault(),
  name: t.text,
  note: t.text.nullable(),
})

/** Node of a parameter of `value` encoded with `type`, as a value of a column becomes one. */
function createValue(value: unknown, type: AnyType): ParamNode {
  return { kind: "param", value, type }
}

describe("toInsertRows", () => {
  it("places the values of each record by column, in the order that the records first give the columns, with DEFAULT where a record omits one", () => {
    expect(
      toInsertRows(
        form,
        [{ name: "Survey" }, { note: null, name: "Feedback", id: "form-id" }],
        "insertMany",
      ),
    ).toEqual({
      columns: ["name", "note", "id"],
      values: [
        [createValue("Survey", t.text), undefined, undefined],
        [
          createValue("Feedback", t.text),
          createValue(null, form.columns.note.type),
          createValue("form-id", t.uuid),
        ],
      ],
    })
  })

  it("omits a column of undefined, also from the columns", () => {
    expect(toInsertRows(form, [{ name: "Survey", note: undefined }], "insert")).toEqual({
      columns: ["name"],
      values: [[createValue("Survey", t.text)]],
    })
  })

  it("keeps an expression as its node", () => {
    const name = sql<string>`upper(${"survey"})`

    expect(toInsertRows(form, [{ name }], "insert").values).toEqual([[toNode(name)]])
  })

  it("lists no column for one record without values, and the first column for several", () => {
    expect(toInsertRows(form, [{}], "insert")).toEqual({ columns: [], values: [[]] })
    expect(toInsertRows(form, [{}, { note: undefined }], "insertMany")).toEqual({
      columns: ["id"],
      values: [[undefined], [undefined]],
    })
  })

  it("takes a query of one value as a value", () => {
    const value = from(form).take().get("name")

    expect(toInsertRows(form, [{ name: value }], "insert")).toEqual({
      columns: ["name"],
      values: [[{ kind: "nestedQuery", query: value.node, db: undefined }]],
    })
  })

  it("rejects no records, a record that is not an object, a key that is not a column, and a query other than of one value", () => {
    expect(() => toInsertRows(form, [], "insertMany")).toThrow(
      "insertMany takes at least one record",
    )
    expect(() => toInsertRows(form, [null], "insert")).toThrow(
      'insert takes records of the values of the columns of table "form"',
    )
    expect(() => toInsertRows(form, [{ name: "Survey", title: "Survey" }], "insert")).toThrow(
      'Unknown column "title" of table "form"',
    )
    expect(() => toInsertRows(form, [{ toString: "Survey" }], "insert")).toThrow(
      'Unknown column "toString" of table "form"',
    )
    expect(() => toInsertRows(form, [{ name: from(form).pluck("name") }], "insert")).toThrow(
      "An expression takes a query of one value",
    )
  })
})

describe("toAssignments", () => {
  const source = from(form).node.from

  it("assigns the values of the columns, skipping a column of undefined", () => {
    expect(toAssignments(source, { note: null, name: "Survey", id: undefined })).toEqual([
      { key: "note", value: createValue(null, form.columns.note.type) },
      { key: "name", value: createValue("Survey", t.text) },
    ])
  })

  it("gives a callback the columns of the source", () => {
    const assignments = toAssignments(source, (columns: { name: unknown }) => ({
      note: columns.name,
    }))

    expect(assignments).toEqual([{ key: "note", value: createRef(source, "name") }])
  })

  it("takes a query of one value as a value", () => {
    const value = from(form).take().get("name")

    expect(toAssignments(source, { name: value })).toEqual([
      { key: "name", value: { kind: "nestedQuery", query: value.node, db: undefined } },
    ])
  })

  it("rejects values without a column to set, a value that is not an object, a key that is not a column, and a query other than of one value", () => {
    const message =
      'update takes the value of at least one column of table "form"; a column given as undefined keeps its value'

    expect(() => toAssignments(source, {})).toThrow(message)
    expect(() => toAssignments(source, { name: undefined })).toThrow(message)
    expect(() => toAssignments(source, () => "Survey")).toThrow(
      'update takes the values of the columns of table "form" or a callback that returns them',
    )
    expect(() => toAssignments(source, { title: "Survey" })).toThrow(
      'Unknown column "title" of table "form"',
    )
    expect(() => toAssignments(source, { name: from(form).pluck("name") })).toThrow(
      "An expression takes a query of one value",
    )
  })
})
