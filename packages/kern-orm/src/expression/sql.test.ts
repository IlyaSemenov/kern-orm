import { expect, it } from "bun:test"

import { createRecordingDriver } from "../../testing/recording-driver"
import { createDatabase } from "../execution/database"
import { from } from "../query/select"
import { defineSchema } from "../schema/schema"
import { defineTable } from "../table/table"
import * as t from "../types"

import { getType, toNode } from "./expression"
import { identifier, param, sql } from "./sql"

const form = defineTable("form", {
  id: t.integer.primaryKey(),
})

const schema = defineSchema({ form })

it("rejects a column passed to sql as a type", () => {
  // @ts-expect-error A column is not a type.
  expect(() => sql(t.uuid.primaryKey())).toThrow("sql() accepts a type, not a column")
})

it("interpolates a query of a table without clauses as the name of the table of its Db", () => {
  const db = createDatabase({ driver: createRecordingDriver().driver }).bind(schema)

  expect(toNode(sql`SELECT FROM ${schema.form} JOIN ${db.form}`)).toEqual({
    kind: "raw",
    fragments: ["SELECT FROM ", " JOIN ", ""],
    values: [
      { kind: "tableName", table: form, db: undefined },
      { kind: "tableName", table: form, db },
    ],
  })
})

it("interpolates another query of a table, of any rows and value, as a query in an expression of its Db", () => {
  const db = createDatabase({ driver: createRecordingDriver().driver }).bind(schema)
  const records = schema.form.where({ id: 1 })
  const values = db.form.pluck("id")

  expect(toNode(sql`EXISTS ${records} AND ${1} IN ${values}`)).toEqual({
    kind: "raw",
    fragments: ["EXISTS ", " AND ", " IN ", ""],
    values: [
      { kind: "nestedQuery", query: records.node, db: undefined },
      { kind: "param", value: 1, type: undefined },
      { kind: "nestedQuery", query: values.node, db },
    ],
  })
})

it("rejects a query of $select, a mutation, and a query of SQL text, which a parameter would encode as text", () => {
  const db = createDatabase({ driver: createRecordingDriver().driver }).bind(schema)

  for (const query of [schema.$select({}), schema.form.find(1).delete(), db.$query`SELECT 1`]) {
    expect(() => sql`SELECT ${query}`).toThrow(
      "sql takes a query of a table, such as db.form or a query of its records, not a query of $select, a mutation, or a query of SQL text",
    )
  }
})

it("creates a fragment of a quoted name with identifier, keeping dots and doubling quotes", () => {
  expect(toNode(sql`SELECT FROM ${identifier('app.form "draft"')}`)).toEqual({
    kind: "raw",
    fragments: ["SELECT FROM ", ""],
    values: [{ kind: "raw", fragments: ['"app.form ""draft"""'], values: [] }],
  })
})

it("creates a fragment of a qualified name of several names with identifier", () => {
  expect(toNode(identifier("app", "form", "name"))).toEqual({
    kind: "raw",
    fragments: ['"app"."form"."name"'],
    values: [],
  })
})

it("rejects a call of identifier without names or with an empty or non-string name", () => {
  const message = "identifier() takes names as non-empty strings"

  // @ts-expect-error A name is required.
  expect(() => identifier()).toThrow("identifier() takes at least one name")
  expect(() => identifier("app", "")).toThrow(message)
  // @ts-expect-error A name is a string.
  expect(() => identifier("app", undefined)).toThrow(message)
})

it("returns an expression value of param as it is", () => {
  const nullable = param(t.integer.nullable(), null)
  expect(param(param(t.integer, 1), nullable)).toBe(nullable)
})

it("gives a query operand of param the runtime type of the expression", () => {
  const value = param(t.integer, 1)
  const query = from(form).count()
  const expression = param(value, query)

  expect(toNode(expression)).toEqual({ kind: "nestedQuery", query: query.node, db: undefined })
  expect(getType(expression)).toBe(t.integer)
})

it("selects a constant through param with a type", () => {
  const query = from(form).select(() => ({
    source: param(t.text, "form"),
  }))

  expect(query.toSQL()).toEqual({
    text: 'SELECT $1::text AS "source" FROM "form" AS "form"',
    parameters: ["form"],
  })
})

it("rejects a column passed to param as a type", () => {
  // @ts-expect-error A column is not a type.
  expect(() => param(t.uuid.primaryKey(), "id")).toThrow(
    "param() accepts a type or an expression, not a column",
  )
})
