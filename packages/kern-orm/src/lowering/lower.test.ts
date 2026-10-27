import { describe, expect, it } from "bun:test"

import { describePostgres } from "../../testing/postgres"
import { createRecordingDriver } from "../../testing/recording-driver"
import { compileSelect } from "../compiler/postgres/compile"
import { createDatabase } from "../execution/database"
import { createStatement } from "../execution/driver"
import { sql } from "../expression/sql"
import { desc } from "../query/order"
import type { NestedField } from "../result/result"
import { collectDefinitions, many } from "../schema/relation"
import { defineSchema, schemaRelations } from "../schema/schema"
import { defineTable } from "../table/table"
import * as t from "../types"

import { lowerQuery, lowerStatement } from "./lower"

const form = defineTable("form", {
  id: t.integer,
})

const field = defineTable("form_field", {
  id: t.integer,
  formId: t.integer,
  label: t.text,
})

const option = defineTable("field_option", {
  fieldId: t.integer,
})

const forms = defineSchema({ form, field }).$relations({
  form: {
    fields: many(field, { from: "id", to: "formId" }),
  },
})

const schema = defineSchema(forms, { option }).$relations({
  field: {
    options: many(option, { from: "id", to: "fieldId" }),
  },
})

describe("lowerStatement", () => {
  it("sorts by the positions of the projections of the same columns and expression nodes, and by other expressions as they are", () => {
    const { node } = schema.field
      .select("id")
      .select(field => ({
        upper: sql(t.text)`upper(${field.label})`,
      }))
      .orderBy((field, selected) => [desc(selected.upper), field.id, field.label])

    expect(compileSelect(lowerStatement(node)).text).toEndWith(
      'ORDER BY 2 DESC, 1, "form_field"."label"',
    )
    expect(lowerQuery(node).orderBy).toBe(node.orderBy)
  })

  it("keeps the sort expressions of nested queries, which packing reads", () => {
    const { node } = schema.form.select("id").select(form => ({
      labels: form.fields.orderBy("label").pluck("label"),
    }))

    expect(compileSelect(lowerStatement(node)).text).toContain('ORDER BY "subquery"."label"')
  })
})

describe("lowerQuery", () => {
  it("keeps the projections of a query without nested queries", () => {
    const { node } = schema.form.select("id")

    expect<readonly unknown[]>(lowerQuery(node).projections).toBe(node.projections)
  })

  it("selects the packed rows of a nested query, decoded by its result plan, in place of its field", () => {
    const { node } = schema.form.select(form => ({
      fields: form.fields.pluck("label"),
      id: form.id,
    }))
    const [fields, id] = lowerQuery(node).projections

    expect(fields).toMatchObject({ key: "fields", expression: { kind: "subquery" } })
    expect((fields as NestedField).nested).toMatchObject({ rows: "many", value: true })
    expect<unknown>(id).toBe(node.projections[1])
  })

  it("rejects a relation outside the definitions at any depth", () => {
    const { node } = schema.form.select(form => ({
      fields: form.fields.select(field => ({
        options: field.options,
      })),
    }))

    expect(() => lowerQuery(node, collectDefinitions(forms[schemaRelations]))).toThrow(
      'Relation "field.options" is not part of the schema',
    )
    expect(() => lowerQuery(node, collectDefinitions(schema[schemaRelations]))).not.toThrow()
    expect(() => lowerQuery(node)).not.toThrow()
  })

  it("rejects a nested query bound to another Db than the one given at any depth", () => {
    const database = createDatabase({ driver: createRecordingDriver().driver })
    const db = database.bind(schema)
    const otherDb = database.bind(schema)
    const { node } = schema.form.select(form => ({
      fields: form.fields.select(field => ({
        options: db.option.where(option => option.fieldId.eq(field.id)),
      })),
    }))

    expect(() => lowerQuery(node, undefined, otherDb)).toThrow(
      'Selected field "options" is bound to another Db',
    )
    expect(() => lowerQuery(node, undefined, db)).not.toThrow()
    expect(() => lowerQuery(node)).not.toThrow()
  })
})

describePostgres("in PostgreSQL", ({ database, testTransaction, useTestFixture, runStatement }) => {
  useTestFixture(async () => {
    await runStatement("CREATE TABLE form (id integer)")
    await runStatement("INSERT INTO form SELECT generate_series(1, 20)")
  })

  const db = database.bind(defineSchema({ form }))

  it("sorts an executed query by the values of a selected expression, evaluated once", async () => {
    const query = db.form
      .select(() => ({
        number: sql(t.integer)`nextval('number_sequence')::integer + ${0}`,
      }))
      .orderBy((_form, selected) => desc(selected.number))
    const { rows, evaluations } = await testTransaction(async () => {
      // A generic plan keeps parameters, so PostgreSQL would evaluate the expression repeated in `ORDER BY` with a parameter of its own again.
      await runStatement("SET LOCAL plan_cache_mode = force_generic_plan")
      await runStatement("CREATE SEQUENCE number_sequence")
      const rows = await db.$execute(query)
      const { rows: counts } = await database.execute(
        createStatement("SELECT currval('number_sequence')"),
      )
      return { rows, evaluations: counts[0]![0] }
    })

    expect(rows.map(row => row.number)).toEqual(
      Array.from({ length: 20 }, (_, index) => 20 - index),
    )
    expect(evaluations).toBe("20")
  })
})
