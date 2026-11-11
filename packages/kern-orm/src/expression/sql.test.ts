import { expect, it } from "bun:test"

import { createRecordingDriver } from "../../testing/database/recording-driver"
import { defineCodec } from "../database/codec/codec"
import { jsonb } from "../database/codecs/json"
import {
  identifier as identifierFragment,
  param as paramFragment,
  sql as sqlFragment,
} from "../database/sql/fragment"
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

it("rejects a codec without operators passed to sql, naming defineType", () => {
  // @ts-expect-error A codec without operators is not a type.
  expect(() => sql(defineCodec({ sqlType: "ltree" }))).toThrow(
    "sql() accepts a type, not a codec without operators; create a type from it with defineType(codec)",
  )
})

it("interpolates a query of a table without clauses, also of a singleton table, as the name of the table of its Db", () => {
  const db = createDatabase({ driver: createRecordingDriver().driver }).bind(schema)
  const license = defineTable(
    "license",
    {
      token: t.text,
    },
    { singleton: true },
  )

  expect(toNode(sql`SELECT FROM ${schema.form} JOIN ${db.form} JOIN ${from(license)}`)).toEqual({
    kind: "raw",
    fragments: ["SELECT FROM ", " JOIN ", " JOIN ", ""],
    values: [
      { kind: "tableName", table: form, db: undefined },
      { kind: "tableName", table: form, db },
      { kind: "tableName", table: license, db: undefined },
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

it("interpolates a query of distinct as a query in an expression rather than the name of its table", () => {
  const unique = schema.form.distinct()

  expect(toNode(sql`SELECT FROM ${unique}`)).toEqual({
    kind: "raw",
    fragments: ["SELECT FROM ", ""],
    values: [{ kind: "nestedQuery", query: unique.node, db: undefined }],
  })
})

it("rejects a query of $select, a mutation, a query of SQL text, and a query of map or transform", () => {
  const db = createDatabase({ driver: createRecordingDriver().driver }).bind(schema)

  for (const query of [
    schema.$select({}),
    schema.form.find(1).delete(),
    db.$query`SELECT 1`,
    schema.form.count().map(String),
    schema.form.count().transform(String),
  ]) {
    expect(() => sql`SELECT ${query}`).toThrow(
      /^sql takes a query of a table, such as db\.form or a query of its records, not a query of (\$select, a mutation, a query of SQL text, or a query of )?map or transform$/,
    )
  }
})

it("rejects a value that a parameter does not take without a type when the template is created, naming param", () => {
  const takes =
    "A parameter without a codec takes a string, a number, a bigint, a boolean, null, a Date, or a Uint8Array"

  for (const [value, kind] of [
    [{ name: "Survey" }, "an object"],
    [t.integer, "an object"],
    [form.columns.id, "an object"],
    [[1, 2], "an array"],
    [() => 1, "a function"],
  ] as const) {
    expect(() => sql`SELECT ${value}`).toThrow(
      new TypeError(`${takes}, not ${kind}; pass JSON or an array with param()`),
    )
  }
  expect(() => sql`SELECT ${undefined}`).toThrow("Query parameter is undefined; use null for NULL")
})

it("interpolates JSON and an array through param with a type", () => {
  const query = from(form).where(
    () => sql<boolean>`${param(t.jsonb, { a: 1 })} @> ${param(t.array(t.integer), [1, 2])}`,
  )

  expect(query.toSQL()).toEqual({
    text: 'SELECT FROM "form" AS "form" WHERE ($1::jsonb) @> ($2::integer[])',
    parameters: ['{"a":1}', '{"1","2"}'],
  })
})

it("interpolates a fragment of the database layer as SQL, numbering its parameters with those of the statement", () => {
  const condition = sqlFragment`${identifierFragment("data")} @> ${paramFragment(jsonb, { a: 1 })} AND size > ${3}`
  const query = from(form).where(() => sql<boolean>`${1} = ${1} AND ${condition} AND ${2} = ${2}`)

  expect(toNode(sql`SELECT ${condition}`)).toEqual({
    kind: "raw",
    fragments: ["SELECT ", ""],
    values: [{ kind: "fragment", fragment: condition }],
  })
  expect(query.toSQL()).toEqual({
    text: 'SELECT FROM "form" AS "form" WHERE $1 = $2 AND "data" @> ($3::jsonb) AND size > $4 AND $5 = $6',
    parameters: ["1", "1", '{"a":1}', "3", "2", "2"],
  })
})

it("creates an expression of the quoted name of the database layer with identifier", () => {
  expect(toNode(identifier("app", 'form "draft"'))).toEqual({
    kind: "fragment",
    fragment: identifierFragment("app", 'form "draft"'),
  })
  expect(
    from(form)
      .where(() => identifier("form", "id").eq(1))
      .toSQL(),
  ).toEqual({
    text: 'SELECT FROM "form" AS "form" WHERE ("form"."id") = $1',
    parameters: ["1"],
  })
})

it("rejects a call of identifier without names or with a non-string name", () => {
  // @ts-expect-error A name is required.
  expect(() => identifier()).toThrow("identifier() takes at least one name")
  // @ts-expect-error A name is a string.
  expect(() => identifier("app", undefined)).toThrow(
    "identifier() takes names as non-empty strings",
  )
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

it("rejects a codec without operators passed to param, naming defineType", () => {
  // @ts-expect-error A codec without operators is not a type.
  expect(() => param(defineCodec({ sqlType: "ltree" }), "a.b")).toThrow(
    "param() accepts a type or an expression, not a codec without operators; create a type from it with defineType(codec)",
  )
})
