import { expect, it } from "bun:test"

import { createRecordingDriver } from "../../testing/recording-driver"
import { createDatabase } from "../execution/database"
import { defineSchema } from "../schema/schema"
import { defineTable } from "../table/table"
import * as t from "../types"

import { toNode } from "./expression"
import { param, sql } from "./sql"

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

it("rejects a query with clauses and other queries, which a parameter would encode as text", () => {
  const db = createDatabase({ driver: createRecordingDriver().driver }).bind(schema)

  expect(() => sql`SELECT FROM ${schema.form.where({ id: 1 })}`).toThrow(
    "sql takes a query of a table without clauses, such as db.form, as the name of the table, not a query with clauses",
  )
  for (const query of [schema.$select({}), schema.form.find(1).delete(), db.$query`SELECT 1`]) {
    expect(() => sql`SELECT ${query}`).toThrow(
      "sql takes a query of a table without clauses, such as db.form, as the name of the table, not another query",
    )
  }
})

it("returns an expression value of param as it is", () => {
  const nullable = param(t.integer.nullable(), null)
  expect(param(param(t.integer, 1), nullable)).toBe(nullable)
})

it("rejects a column passed to param as a type", () => {
  // @ts-expect-error A column is not a type.
  expect(() => param(t.uuid.primaryKey(), "id")).toThrow(
    "param() accepts a type or an expression, not a column",
  )
})
