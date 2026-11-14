import { describe, expect, it } from "bun:test"

import type { ParamNode } from "../ast/nodes"
import { createRef } from "../ast/testing"
import { toNode } from "../expression/expression"
import { sql } from "../expression/sql"
import { many } from "../schema/relation"
import { defineSchema } from "../schema/schema"
import { defineTable } from "../table/table"
import type { AnyType } from "../type/type"
import * as t from "../types"

import { noContext } from "./column-refs"
import { from, SelectQuery } from "./select"
import { addColumnDefaults, toAssignments, toInsertRows } from "./values"

const form = defineTable("form", {
  id: t.uuid.primaryKey().hasDefault(),
  name: t.text,
  note: t.text.nullable(),
})

const field = defineTable("field", {
  id: t.uuid.primaryKey().hasDefault(),
  formId: t.uuid,
})

const schema = defineSchema({ form, field }).$relations({
  form: {
    fields: many(field, { from: "id", to: "formId" }),
  },
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

describe("addColumnDefaults", () => {
  it("returns the rows as they are for a table without defaults of kern-orm", () => {
    const rows = toInsertRows(form, [{ name: "Survey" }], "insert")

    expect(addColumnDefaults(form, rows)).toBe(rows)
  })

  it("gives each record that omits a column its default, calling a function record by record, and adds the columns that no record gives", () => {
    const calls: string[] = []
    const task = defineTable("task", {
      id: t.integer.primaryKey().hasDefault(),
      state: t.text.default("draft"),
      token: t.text.default(() => {
        calls.push("token")
        return `token-${calls.length}`
      }),
      rank: t.integer.default(() => {
        calls.push("rank")
        return calls.length
      }),
    })
    const rows = toInsertRows(task, [{ token: "given" }, { state: "done" }, {}], "insertMany")

    expect(addColumnDefaults(task, rows)).toEqual({
      columns: ["token", "state", "rank"],
      values: [
        [createValue("given", t.text), createValue("draft", t.text), createValue(1, t.integer)],
        [createValue("token-2", t.text), createValue("done", t.text), createValue(3, t.integer)],
        [createValue("token-4", t.text), createValue("draft", t.text), createValue(5, t.integer)],
      ],
    })
    expect(calls).toEqual(["rank", "token", "rank", "token", "rank"])
    expect(rows.columns).toEqual(["token", "state"])
  })

  it("keeps a value of null, and DEFAULT where a function returns undefined", () => {
    const task = defineTable("task", {
      note: t.text.nullable().default("note"),
      label: t.text.default(() => undefined as unknown as string),
    })
    const rows = toInsertRows(task, [{ note: null }], "insert")

    expect(addColumnDefaults(task, rows)).toEqual({
      columns: ["note", "label"],
      values: [[createValue(null, task.columns.note.type), undefined]],
    })
  })

  it("keeps an expression as its node", () => {
    const createdAt = sql<string>`now()`
    const task = defineTable("task", {
      createdAt: t.timestamptz.default(createdAt),
      dueAt: t.timestamptz.default(() => createdAt),
    })

    expect(addColumnDefaults(task, toInsertRows(task, [{}], "insert"))).toEqual({
      columns: ["createdAt", "dueAt"],
      values: [[toNode(createdAt), toNode(createdAt)]],
    })
  })
})

describe("toAssignments", () => {
  const source = from(form).node.from

  it("assigns the values of the columns, skipping a column of undefined", () => {
    expect(toAssignments(source, { note: null, name: "Survey", id: undefined }, noContext)).toEqual(
      [
        { key: "note", value: createValue(null, form.columns.note.type) },
        { key: "name", value: createValue("Survey", t.text) },
      ],
    )
  })

  it("gives a callback the columns of the source", () => {
    const assignments = toAssignments(
      source,
      (columns: { name: unknown }) => ({
        note: columns.name,
      }),
      noContext,
    )

    expect(assignments).toEqual([{ key: "note", value: createRef(source, "name") }])
  })

  it("gives a callback the relations of the context beside the columns", () => {
    let refs: object | undefined
    toAssignments(
      source,
      (columns: object) => {
        refs = columns
        return { name: "Survey" }
      },
      schema.form.context,
    )

    expect(Reflect.get(refs!, "name")).toBeDefined()
    expect(Reflect.get(refs!, "fields")).toBeInstanceOf(SelectQuery)
  })

  it("takes a query of one value as a value, also from a callback", () => {
    const value = from(form).take().get("name")

    expect(toAssignments(source, { name: value }, noContext)).toEqual([
      { key: "name", value: { kind: "nestedQuery", query: value.node, db: undefined } },
    ])
    expect(toAssignments(source, () => ({ name: value }), noContext)).toEqual([
      { key: "name", value: { kind: "nestedQuery", query: value.node, db: undefined } },
    ])
  })

  it("gives no assignments for values without a column to set", () => {
    expect(toAssignments(source, {}, noContext)).toEqual([])
    expect(toAssignments(source, () => ({ name: undefined }), noContext)).toEqual([])
  })

  it("rejects a value that is not an object, a key that is not a column, and a query other than of one value", () => {
    expect(() => toAssignments(source, () => "Survey", noContext)).toThrow(
      'update takes the values of the columns of table "form" or a callback that returns them',
    )
    expect(() => toAssignments(source, { title: "Survey" }, noContext)).toThrow(
      'Unknown column "title" of table "form"',
    )
    expect(() => toAssignments(source, { name: from(form).pluck("name") }, noContext)).toThrow(
      "An expression takes a query of one value",
    )
  })
})
