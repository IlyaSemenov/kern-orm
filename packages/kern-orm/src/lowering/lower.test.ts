import { describe, expect, it } from "bun:test"

import { describePostgres } from "../../testing/postgres"
import { createRecordingDriver } from "../../testing/recording-driver"
import { compileStatement } from "../compiler/postgres/compile"
import { createDatabase } from "../execution/database"
import { count, every, sum } from "../expression/aggregates"
import type { AnyExpression } from "../expression/expression"
import { and, not } from "../expression/predicates"
import { sql } from "../expression/sql"
import { countType } from "../query/aggregate"
import { literal } from "../query/literal"
import { desc } from "../query/order"
import type { AnySelectQuery } from "../query/select"
import type { NestedField } from "../result/result"
import { NotFoundError } from "../result/result"
import { collectDefinitions, many, one } from "../schema/relation"
import { defineSchema, schemaRelations } from "../schema/schema"
import { defineTable } from "../table/table"
import * as t from "../types"

import { lowerQuery, lowerStatement } from "./lower"

const form = defineTable("form", {
  id: t.integer.primaryKey(),
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
  field: {
    form: one(form, { from: "formId", to: "id", required: true }),
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

    expect(compileStatement(lowerStatement(node)).text).toEndWith(
      'ORDER BY 2 DESC, 1, "form_field"."label"',
    )
    expect(lowerQuery(node).orderBy).toBe(node.orderBy)
  })

  it("sorts by the position of a selected expression that holds a query, lowered once", () => {
    const { node } = schema.form
      .select(form => ({
        empty: not(form.fields.exists()),
      }))
      .orderBy((_form, selected) => desc(selected.empty))

    expect(compileStatement(lowerStatement(node)).text).toBe(
      'SELECT NOT EXISTS (SELECT FROM "form_field" AS "form_field" WHERE "form_field"."formId" = "form"."id") AS "empty" FROM "form" AS "form" ORDER BY 1 DESC',
    )
  })

  it("sorts by the positions of the selected fields of an aggregate and of exists, and by another query of one value as a subquery", () => {
    const { node } = schema.form
      .select(form => ({
        fieldCount: form.fields.count(),
        hasFields: form.fields.exists(),
      }))
      .orderBy((form, selected) => [
        desc(selected.fieldCount),
        selected.hasFields,
        form.fields.max("id"),
      ])

    expect(compileStatement(lowerStatement(node)).text).toBe(
      'SELECT (SELECT count(*) AS "count" FROM "form_field" AS "form_field" WHERE "form_field"."formId" = "form"."id") AS "fieldCount", EXISTS (SELECT FROM "form_field" AS "form_field_2" WHERE "form_field_2"."formId" = "form"."id") AS "hasFields" FROM "form" AS "form" ORDER BY 1 DESC, 2, (SELECT max("form_field_3"."id") AS "max" FROM "form_field" AS "form_field_3" WHERE "form_field_3"."formId" = "form"."id")',
    )
  })

  it("sorts by the position of the field that a sort key names, of a query selected under several keys, and by the query held apart as a subquery of its own", () => {
    const count = schema.form.count()
    const query = schema.form
      .select(() => ({
        count1: count,
        count2: count,
      }))
      .orderBy((_form, selected) => [desc(selected.count2), count])

    expect(compileStatement(lowerStatement(query.node)).text).toBe(
      'SELECT (SELECT count(*) AS "count" FROM "form" AS "form_2") AS "count1", (SELECT count(*) AS "count" FROM "form" AS "form_3") AS "count2" FROM "form" AS "form" ORDER BY 2 DESC, (SELECT count(*) AS "count" FROM "form" AS "form_4")',
    )
    expect(
      compileStatement(
        lowerStatement(
          query
            .select(form => ({
              fields: form.fields.pluck("label"),
            }))
            .offset(20).node,
        ),
      ).text,
    ).toStartWith(
      'SELECT (SELECT count(*) AS "count" FROM "form" AS "form_2") AS "count1", "form"."$field2" AS "count2", ',
    )
  })

  it("reads the page of a query that selects nested queries after an offset from a derived source of the page, sorted again", () => {
    const page = schema.form.orderBy("id").offset(20)
    const { node } = page.select(form => ({
      fields: form.fields.pluck("label"),
    }))

    const text = compileStatement(lowerStatement(node)).text

    expect(text).toContain('WHERE "form_field"."formId" = "form"."id"')
    expect(text).toEndWith(
      ' FROM (SELECT "form_2"."id" AS "id" FROM "form" AS "form_2" ORDER BY 1 OFFSET $1) AS "form" ORDER BY "form"."id"',
    )
  })

  it("evaluates the scalar fields of a page after an offset in the derived source of the page, which sorts by them", () => {
    const { node } = schema.field
      .select(field => ({
        upper: sql(t.text)`upper(${field.label})`,
        optionCount: field.options.count(),
      }))
      .orderBy((field, selected) => [desc(selected.upper), field.id])
      .offset(20)

    const text = compileStatement(lowerStatement(node)).text

    expect(text).toStartWith('SELECT "form_field"."$field1" AS "upper", (SELECT count(*)')
    expect(text).toEndWith(
      ' FROM (SELECT "form_field_2"."id" AS "id", upper("form_field_2"."label") AS "$field1" FROM "form_field" AS "form_field_2" ORDER BY 2 DESC, 1 OFFSET $1) AS "form_field" ORDER BY 1 DESC, "form_field"."id"',
    )
  })

  it("evaluates the fields of an aggregate and of exists that a page after an offset sorts by in the derived source of the page, and keeps a page without other nested queries on its table", () => {
    const sorted = schema.form
      .select(form => ({
        fieldCount: form.fields.count(),
        hasFields: form.fields.exists(),
      }))
      .orderBy((_form, selected) => [desc(selected.fieldCount), selected.hasFields])
      .offset(20)
    const nested = sorted.select(form => ({
      labels: form.fields.pluck("label"),
    }))

    expect(compileStatement(lowerStatement(sorted.node)).text).toEndWith(
      ' FROM "form" AS "form" ORDER BY 1 DESC, 2 OFFSET $1',
    )
    const text = compileStatement(lowerStatement(nested.node)).text
    expect(text).toStartWith(
      'SELECT "form"."$field1" AS "fieldCount", "form"."$field2" AS "hasFields", (SELECT coalesce(json_agg(',
    )
    expect(text).toEndWith(
      ' FROM (SELECT "form_2"."id" AS "id", (SELECT count(*) AS "count" FROM "form_field" AS "form_field_2" WHERE "form_field_2"."formId" = "form_2"."id") AS "$field1", EXISTS (SELECT FROM "form_field" AS "form_field_3" WHERE "form_field_3"."formId" = "form_2"."id") AS "$field2" FROM "form" AS "form_2" ORDER BY 2 DESC, 3 OFFSET $1) AS "form" ORDER BY 1 DESC, 2',
    )
  })

  it("reads the page of a query that selects a nested query of exists after an offset from a derived source of the page", () => {
    const { node } = schema.form
      .orderBy("id")
      .offset(20)
      .select(form => ({
        hasFields: form.fields.exists(),
      }))

    expect(compileStatement(lowerStatement(node)).text).toBe(
      'SELECT EXISTS (SELECT FROM "form_field" AS "form_field" WHERE "form_field"."formId" = "form"."id") AS "hasFields" FROM (SELECT "form_2"."id" AS "id" FROM "form" AS "form_2" ORDER BY 1 OFFSET $1) AS "form" ORDER BY "form"."id"',
    )
  })

  it("derives a page after an offset only when the aggregates of its nested queries read no column of its table", () => {
    const page = schema.form.orderBy("id").offset(20)
    const parentColumn = page.select(form => ({
      total: schema.field.select(() => ({
        sum: sum(form.id),
      })),
    }))
    const bothColumns = page.select(form => ({
      total: schema.field.select(field => ({
        every: every(field.id.eq(form.id)),
      })),
    }))
    const ownColumn = page.select(form => ({
      total: form.fields.select(field => ({
        fields: count(),
        sum: sum(field.id),
      })),
    }))

    expect(compileStatement(lowerStatement(parentColumn.node)).text).toEndWith(
      ' FROM "form" AS "form" ORDER BY "form"."id" OFFSET $1',
    )
    expect(compileStatement(lowerStatement(bothColumns.node)).text).toEndWith(
      ' FROM "form" AS "form" ORDER BY "form"."id" OFFSET $1',
    )
    expect(compileStatement(lowerStatement(ownColumn.node)).text).toEndWith(
      ' FROM (SELECT "form_2"."id" AS "id" FROM "form" AS "form_2" ORDER BY 1 OFFSET $1) AS "form" ORDER BY "form"."id"',
    )
  })

  it("keeps the page of a query on its table without an offset, without nested queries, also with queries in the expressions of its fields, or with a SQL fragment of its columns in a nested query", () => {
    const limited = schema.form.orderBy("id").limit(20)
    const nested = limited.select(form => ({
      fields: form.fields.pluck("label"),
    }))
    const offset = schema.form.orderBy("id").offset(20).select("id")
    const condition = schema.form
      .orderBy("id")
      .offset(20)
      .select(form => ({
        empty: not(form.fields.exists()),
      }))
    const fragment = schema.form
      .orderBy("id")
      .offset(20)
      .select(form => ({
        total: schema.field.select(() => ({
          sum: sql(t.integer)`sum(${form.id})`,
        })),
      }))

    expect(compileStatement(lowerStatement(nested.node)).text).toEndWith(
      ' FROM "form" AS "form" ORDER BY "form"."id" LIMIT $1',
    )
    expect(compileStatement(lowerStatement(offset.node)).text).toBe(
      'SELECT "form"."id" AS "id" FROM "form" AS "form" ORDER BY 1 OFFSET $1',
    )
    expect(compileStatement(lowerStatement(condition.node)).text).toEndWith(
      ' FROM "form" AS "form" ORDER BY "form"."id" OFFSET $1',
    )
    expect(compileStatement(lowerStatement(fragment.node)).text).toEndWith(
      ' FROM "form" AS "form" ORDER BY "form"."id" OFFSET $1',
    )
  })

  it("lowers a query of exists to a statement without a source of one row of EXISTS of its rows", () => {
    const query = schema.form.where({ id: 1 }).exists()
    const statement = lowerStatement(query.node)

    expect(statement).toMatchObject({ from: undefined, rows: "one", value: true })
    expect(statement.projections).toMatchObject([
      { key: "exists", expression: { kind: "exists" }, type: t.boolean },
    ])
    expect(compileStatement(statement).text).toBe(
      'SELECT EXISTS (SELECT FROM "form" AS "form" WHERE "form"."id" = $1) AS "exists"',
    )
  })

  it("keeps the sort expressions of nested queries, which packing reads", () => {
    const { node } = schema.form.select("id").select(form => ({
      labels: form.fields.orderBy("label").pluck("label"),
    }))

    expect(compileStatement(lowerStatement(node)).text).toContain('ORDER BY "subquery"."label"')
  })

  it("sorts the rows of a nested query by a selected field of an aggregate through its projection", () => {
    const { node } = schema.form.select(form => ({
      fields: form.fields
        .select("id")
        .select(field => ({
          optionCount: field.options.count(),
        }))
        .orderBy((_field, selected) => desc(selected.optionCount))
        .limit(3),
    }))

    const text = compileStatement(lowerStatement(node)).text

    expect(text).toContain('ORDER BY "subquery"."optionCount" DESC), \'[]\'::json)')
    expect(text).toContain(
      'AS "optionCount" FROM "form_field" AS "form_field" WHERE "form_field"."formId" = "form"."id" ORDER BY 2 DESC LIMIT $1) AS "subquery"',
    )
  })

  it("lowers a query of $select to a statement of one row without a source, packing its nested queries", () => {
    const { node } = schema.$select({
      labels: schema.field.pluck("label"),
      number: sql(t.integer)`1`,
    })
    const statement = lowerStatement(node)

    expect(statement).toMatchObject({ from: undefined, joins: [], rows: "one", value: false })
    expect(statement.projections).toMatchObject([
      { key: "labels", nested: { rows: "many", value: true } },
      node.projections[1]!,
    ])
  })

  it("replaces the queries in the fields of a query of $select", () => {
    const { node } = schema.$select({
      hasForms: schema.form.exists(),
      empty: not(schema.form.exists()),
    })

    expect(compileStatement(lowerStatement(node)).text).toBe(
      'SELECT EXISTS (SELECT FROM "form" AS "form") AS "hasForms", NOT EXISTS (SELECT FROM "form" AS "form_2") AS "empty"',
    )
  })

  it("checks the relations and the Db of the nested queries of a query of $select", () => {
    const database = createDatabase({ driver: createRecordingDriver().driver })
    const db = database.bind(schema)
    const { node } = schema.$select({
      fields: schema.field.select(field => ({
        options: field.options,
      })),
      forms: db.form,
    })

    expect(() => lowerStatement(node, collectDefinitions(forms[schemaRelations]))).toThrow(
      'Relation "field.options" is not part of the schema',
    )
    expect(() => lowerStatement(node, undefined, database.bind(schema))).toThrow(
      'Selected field "forms" is bound to another Db',
    )
    expect(() =>
      lowerStatement(node, collectDefinitions(schema[schemaRelations]), db),
    ).not.toThrow()
  })
  it("lowers a mutation to its statement, packing the nested queries of its returned fields", () => {
    const counted = schema.field.where({ formId: 1 }).delete()
    const { node } = counted.select("id").select(field => ({
      options: field.options,
    }))
    const statement = lowerStatement(node)

    expect<unknown>(lowerStatement(counted.node)).toBe(counted.node)
    expect(statement).toMatchObject({ kind: "delete", rows: "many" })
    expect(statement.kind === "delete" && statement.returning).toMatchObject([
      node.returning![0]!,
      { key: "options", nested: { rows: "many", value: false } },
    ])
  })

  it("replaces the queries in the filters, the values, and the returned fields of a mutation", () => {
    const hasForms = sql(t.integer)`CASE WHEN ${and(schema.form.exists())} THEN 1 ELSE 0 END`
    const remove = schema.form.where(form => not(form.fields.exists())).delete()
    const update = schema.field.where({ id: 1 }).update({ formId: hasForms })
    const insert = schema.option.insert({ fieldId: hasForms }).select(option => ({
      orphan: not(schema.field.where(field => field.id.eq(option.fieldId)).exists()),
    }))

    expect(compileStatement(lowerStatement(remove.node)).text).toBe(
      'DELETE FROM "form" AS "form" WHERE NOT EXISTS (SELECT FROM "form_field" AS "form_field" WHERE "form_field"."formId" = "form"."id")',
    )
    expect(compileStatement(lowerStatement(update.node)).text).toBe(
      'UPDATE "form_field" AS "form_field" SET "formId" = CASE WHEN EXISTS (SELECT FROM "form" AS "form") THEN 1 ELSE 0 END WHERE "form_field"."id" = $1',
    )
    expect(compileStatement(lowerStatement(insert.node)).text).toBe(
      'INSERT INTO "field_option" AS "field_option" ("fieldId") VALUES (CASE WHEN EXISTS (SELECT FROM "form" AS "form") THEN 1 ELSE 0 END) RETURNING NOT EXISTS (SELECT FROM "form_field" AS "form_field" WHERE "form_field"."id" = "field_option"."fieldId") AS "orphan"',
    )
  })

  it("checks the relations and the Db of the nested queries of a mutation", () => {
    const database = createDatabase({ driver: createRecordingDriver().driver })
    const db = database.bind(schema)
    const { node } = schema.field.insert({ id: 1, formId: 1, label: "Name" }).select(field => ({
      options: field.options,
      forms: db.form,
    }))

    expect(() => lowerStatement(node, collectDefinitions(forms[schemaRelations]))).toThrow(
      'Relation "field.options" is not part of the schema',
    )
    expect(() => lowerStatement(node, undefined, database.bind(schema))).toThrow(
      'Selected field "forms" is bound to another Db',
    )
    expect(() =>
      lowerStatement(node, collectDefinitions(schema[schemaRelations]), db),
    ).not.toThrow()
  })

  it("replaces the queries in the expressions interpolated into a statement of SQL text", () => {
    const database = createDatabase({ driver: createRecordingDriver().driver })
    const db = database.bind(schema)
    const query = db.$query`SELECT ${not(db.form.exists())} AS "empty"`
    const plain = db.$query`SELECT ${1}`

    expect(compileStatement(lowerStatement(query.node, undefined, db)).text).toBe(
      'SELECT (NOT EXISTS (SELECT FROM "form" AS "form")) AS "empty"',
    )
    expect<unknown>(lowerStatement(plain.node, undefined, db)).toBe(plain.node)
  })
})

describe("lowerQuery", () => {
  it("keeps the conversion of a query in its statement, whichever the statement is", () => {
    for (const { node } of [
      schema.form.select("id").map(String),
      schema.form.count().map(String),
      schema.form.exists().map(String),
      schema.form
        .select(form => ({
          fields: form.fields.pluck("id"),
        }))
        .offset(1)
        .map(String),
    ]) {
      expect(lowerQuery(node).conversion).toBe(node.conversion)
    }
    expect(lowerQuery(schema.form.select("id").node).conversion).toBeUndefined()
  })

  it("keeps the nodes of a query without queries in its fields, filters, and order", () => {
    const { node } = schema.form
      .where(form => form.id.gt(1))
      .select(form => ({
        id: form.id,
        positive: form.id.gt(0),
      }))
      .orderBy(form => form.id)
    const statement = lowerQuery(node)

    expect<readonly unknown[]>(statement.projections).toBe(node.projections)
    expect(statement.filters).toBe(node.filters)
    expect(statement.orderBy).toBe(node.orderBy)
  })

  it("replaces a query of exists in a condition with EXISTS of its rows, and another query of one value with a scalar subquery of its statement", () => {
    const { node } = schema.form
      .where(form => form.fields.exists())
      .where(form => not(form.fields.where({ label: "Email" }).exists()))
      .where(() => schema.field.get(field => field.label.eq("Name")))
      .where(form => form.fields.some(field => field.label.eq("Phone")))

    expect(compileStatement(lowerQuery(node))).toMatchObject({
      text: 'SELECT FROM "form" AS "form" WHERE EXISTS (SELECT FROM "form_field" AS "form_field" WHERE "form_field"."formId" = "form"."id") AND NOT EXISTS (SELECT FROM "form_field" AS "form_field_2" WHERE "form_field_2"."formId" = "form"."id" AND "form_field_2"."label" = $1) AND (SELECT "form_field_3"."label" = $2 AS "value" FROM "form_field" AS "form_field_3" LIMIT 1) AND (SELECT bool_or("form_field_4"."label" = $3) AS "some" FROM "form_field" AS "form_field_4" WHERE "form_field_4"."formId" = "form"."id")',
      parameters: ["Email", "Name", "Phone"],
    })
  })

  it("replaces a query of records or of rows many in SQL text with its statement in parentheses, and a query of one value with its value, as in a condition", () => {
    const { node } = schema.form
      .where(form => sql`EXISTS ${form.fields.where({ label: "Email" })}`)
      .where(
        form => sql`${form.id} = ANY ${schema.field.orderBy("label").limit(2).pluck("formId")}`,
      )
      .where(form => sql`${form.fields.count()} > ${1} OR ${form.fields.exists()}`)

    expect(compileStatement(lowerQuery(node))).toMatchObject({
      text: 'SELECT FROM "form" AS "form" WHERE (EXISTS (SELECT FROM "form_field" AS "form_field" WHERE "form_field"."formId" = "form"."id" AND "form_field"."label" = $1)) AND ("form"."id" = ANY (SELECT "form_field_2"."formId" AS "formId" FROM "form_field" AS "form_field_2" ORDER BY "form_field_2"."label" LIMIT $2)) AND ((SELECT count(*) AS "count" FROM "form_field" AS "form_field_3" WHERE "form_field_3"."formId" = "form"."id") > $3 OR EXISTS (SELECT FROM "form_field" AS "form_field_4" WHERE "form_field_4"."formId" = "form"."id"))',
      parameters: ["Email", "2", "1"],
    })
  })

  it("selects EXISTS of a nested query of exists in place of its field, decoded as a Boolean", () => {
    const { node } = schema.form.select(form => ({
      hasFields: form.fields.exists(),
      empty: not(form.fields.exists()),
    }))
    const statement = lowerQuery(node)

    expect(statement.projections).toMatchObject([
      { key: "hasFields", expression: { kind: "exists" }, type: t.boolean },
      { key: "empty", expression: { kind: "not", operand: { kind: "exists" } } },
    ])
    expect(compileStatement(statement).text).toBe(
      'SELECT EXISTS (SELECT FROM "form_field" AS "form_field" WHERE "form_field"."formId" = "form"."id") AS "hasFields", NOT EXISTS (SELECT FROM "form_field" AS "form_field_2" WHERE "form_field_2"."formId" = "form"."id") AS "empty" FROM "form" AS "form"',
    )
  })

  it("replaces the queries in the argument and the fallbacks of an aggregate", () => {
    const { node } = schema.form
      .every(form => and(schema.field.where(field => field.formId.eq(form.id)).exists()))
      .coalesce(and(schema.field.exists()))

    expect(compileStatement(lowerQuery(node)).text).toBe(
      'SELECT coalesce(bool_and("subquery"."value"), EXISTS (SELECT FROM "form_field" AS "form_field")) AS "every" FROM (SELECT EXISTS (SELECT FROM "form_field" AS "form_field_2" WHERE "form_field_2"."formId" = "form"."id") AS "value" FROM "form" AS "form") AS "subquery"',
    )
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

  it("selects the value of a nested aggregate query as a scalar subquery, decoded by the type of the aggregate", () => {
    const { node } = schema.form.select(form => ({
      fieldCount: form.fields.count(),
      firstCount: form.fields.limit(3).count().optional(),
      lastLabel: form.fields.max("label"),
    }))
    const statement = lowerQuery(node)

    expect(statement.projections).toMatchObject([
      { key: "fieldCount", expression: { kind: "subquery" }, type: countType },
      { key: "firstCount", expression: { kind: "subquery" }, type: countType },
      { key: "lastLabel", expression: { kind: "subquery" }, type: t.text },
    ])
    expect(compileStatement(statement).text).toBe(
      'SELECT (SELECT count(*) AS "count" FROM "form_field" AS "form_field" WHERE "form_field"."formId" = "form"."id") AS "fieldCount", (SELECT count(*) AS "count" FROM (SELECT FROM "form_field" AS "form_field_2" WHERE "form_field_2"."formId" = "form"."id" LIMIT $1) AS "subquery") AS "firstCount", (SELECT max("form_field_3"."label") AS "max" FROM "form_field" AS "form_field_3" WHERE "form_field_3"."formId" = "form"."id") AS "lastLabel" FROM "form" AS "form"',
    )
  })

  it("packs a nested aggregate query and a query of exists that code converts, whose result plan holds the conversion", () => {
    const { node } = schema.form.select(form => ({
      fieldCount: form.fields.count().map(String),
      hasFields: form.fields.exists().transform(String),
    }))
    const statement = lowerQuery(node)

    expect(statement.projections).toMatchObject([
      {
        key: "fieldCount",
        expression: { kind: "subquery" },
        nested: { rows: "one", value: true, conversion: { map: expect.any(Function) } },
      },
      {
        key: "hasFields",
        expression: { kind: "subquery" },
        nested: { rows: "one", value: true, conversion: { transform: expect.any(Function) } },
      },
    ])
    expect(compileStatement(statement).text).toBe(
      'SELECT (SELECT json_build_array(CASE WHEN "subquery"."count" IS NOT DISTINCT FROM NULL THEN NULL ELSE format(\'%s\', "subquery"."count") END) AS "rows" FROM (SELECT count(*) AS "count" FROM "form_field" AS "form_field" WHERE "form_field"."formId" = "form"."id" OFFSET 0) AS "subquery") AS "fieldCount", (SELECT json_build_array(CASE WHEN "subquery_2"."exists" IS NOT DISTINCT FROM NULL THEN NULL ELSE format(\'%s\', "subquery_2"."exists") END) AS "rows" FROM (SELECT EXISTS (SELECT FROM "form_field" AS "form_field_2" WHERE "form_field_2"."formId" = "form"."id") AS "exists" OFFSET 0) AS "subquery_2") AS "hasFields" FROM "form" AS "form"',
    )
  })

  it("names the required relation that guarantees the row of a nested query, until the guarantee ends", () => {
    const { node } = schema.field.select(field => ({
      form: field.form.select("id"),
      formId: field.form.get("id"),
      filtered: field.form.where({ id: 1 }).required(),
    }))

    expect(lowerQuery(node).projections).toMatchObject([
      { nested: { rows: "one", guaranteedBy: "field.form" } },
      { nested: { rows: "one", guaranteedBy: "field.form" } },
      { nested: { rows: "one", guaranteedBy: undefined } },
    ])
  })

  it("rejects a relation outside the definitions at any depth, also of a query of count, of exists, of an expression, or in a condition", () => {
    for (const { node } of [
      schema.form.select(form => ({
        fields: form.fields.select(field => ({
          options: field.options,
        })),
      })),
      schema.form.select(form => ({
        fields: form.fields.select(field => ({
          optionCount: field.options.count(),
        })),
      })),
      schema.form.select(form => ({
        fields: form.fields.select(field => ({
          hasOptions: field.options.exists(),
        })),
      })),
      schema.form.select(form => ({
        fields: form.fields.select(field => ({
          optionCount: field.options.count().expr(),
        })),
      })),
      schema.form.where(form => form.fields.where(field => field.options.exists()).exists()),
      schema.field.where(field => field.id.in(field.options.pluck("fieldId"))),
    ]) {
      expect(() => lowerQuery(node, collectDefinitions(forms[schemaRelations]))).toThrow(
        'Relation "field.options" is not part of the schema',
      )
      expect(() => lowerQuery(node, collectDefinitions(schema[schemaRelations]))).not.toThrow()
      expect(() => lowerQuery(node)).not.toThrow()
    }
  })

  it("rejects a nested query bound to another Db than the one given, or to any Db without one, at any depth", () => {
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
    expect(() => lowerQuery(node)).toThrow(
      'Selected field "options" is bound to a Db, so only that Db can compile the query',
    )
  })

  it("rejects a query in an expression, also of the values of in and in SQL text, bound to another Db than the one given, or to any Db without one", () => {
    const database = createDatabase({ driver: createRecordingDriver().driver })
    const db = database.bind(schema)
    for (const { node } of [
      schema.form.where(form => db.field.where(field => field.formId.eq(form.id)).exists()),
      schema.form.where(form => form.id.in(db.field.pluck("formId"))),
      schema.form.where(form => sql`${form.id} = ANY ${db.field.pluck("formId")}`),
    ]) {
      expect(() => lowerQuery(node, undefined, database.bind(schema))).toThrow(
        "A query in an expression is bound to another Db",
      )
      expect(() => lowerQuery(node, undefined, db)).not.toThrow()
      expect(() => lowerQuery(node)).toThrow(
        "A query in an expression is bound to a Db, so only that Db can compile the query",
      )
    }
  })
})

describe("query with a row lock", () => {
  const compile = (query: AnySelectQuery) => compileStatement(lowerStatement(query.node)).text

  it("keeps a page after an offset on its table, so that its nested queries lock their rows before it locks its own", () => {
    const page = schema.form
      .orderBy("id")
      .offset(1)
      .select(form => ({
        fields: form.fields.pluck("id").forUpdate(),
      }))

    expect(compile(page)).toContain('FROM (SELECT "form_2"."id" AS "id" FROM "form" AS "form_2"')
    const locked = compile(page.forUpdate())
    expect(locked).not.toContain('"form_2"')
    expect(locked).toEndWith('FROM "form" AS "form" ORDER BY "form"."id" OFFSET $1 FOR UPDATE')
  })

  it("locks the rows of a query in a condition, a sort key, and a fragment of SQL, which are its statement", () => {
    const lockedForm = schema.form.find(1).get("id").forShare()
    const subquery =
      '(SELECT "form"."id" AS "id" FROM "form" AS "form" WHERE "form"."id" = $1 FOR SHARE)'

    expect(compile(schema.field.where(field => field.formId.eq(lockedForm)))).toBe(
      `SELECT FROM "form_field" AS "form_field" WHERE "form_field"."formId" = ${subquery}`,
    )
    expect(compile(schema.field.orderBy(() => lockedForm))).toBe(
      `SELECT FROM "form_field" AS "form_field" ORDER BY ${subquery}`,
    )
    expect(
      compile(schema.field.where(field => sql<boolean>`${field.formId} = ${lockedForm}`)),
    ).toBe(`SELECT FROM "form_field" AS "form_field" WHERE "form_field"."formId" = ${subquery}`)
  })

  it("locks the rows of the query of the values of in", () => {
    expect(
      compile(
        schema.field.where(field =>
          field.formId.in(
            schema.form.orderBy("id").limit(2).pluck("id").forUpdate({ skipLocked: true }),
          ),
        ),
      ),
    ).toBe(
      'SELECT FROM "form_field" AS "form_field" WHERE "form_field"."formId" IN (SELECT "form"."id" AS "id" FROM "form" AS "form" ORDER BY "form"."id" LIMIT $1 FOR UPDATE SKIP LOCKED)',
    )
  })
})

describe("query of groups", () => {
  const compile = (query: AnySelectQuery) => compileStatement(lowerStatement(query.node)).text
  const totals = schema.field.groupBy("formId").select(field => ({
    formId: field.formId,
    fieldCount: count(),
  }))

  it("sorts by the position of a selected aggregate and by a sort key of another aggregate as it is, after the keys and the condition of the groups", () => {
    expect(
      compile(
        totals
          .having(() => count().gt(1))
          .orderBy((field, selected) => [desc(selected.fieldCount), sum(field.id)]),
      ),
    ).toBe(
      'SELECT "form_field"."formId" AS "formId", count(*) AS "fieldCount" FROM "form_field" AS "form_field" GROUP BY 1 HAVING count(*) > $1 ORDER BY 2 DESC, sum("form_field"."id")',
    )
  })

  it("sorts by the positions of its projections as a subquery, of IN, after take, and in SQL text, whose repeated sort expression would get parameters of its own", () => {
    const residues = schema.field
      .pluck(field => sql(t.integer)`${field.id} % ${3}`)
      .groupBy((_field, value) => value)
      .orderBy((_field, value) => desc(value))
    const statement =
      'SELECT "form_field"."id" % $1 AS "value" FROM "form_field" AS "form_field" GROUP BY 1 ORDER BY 1 DESC'

    expect(compile(schema.form.where(form => form.id.in(residues)).select("id"))).toEndWith(
      `WHERE "form"."id" IN (${statement})`,
    )
    expect(compile(schema.form.where(form => form.id.eq(residues.take())).select("id"))).toEndWith(
      `WHERE "form"."id" = (${statement} LIMIT 1)`,
    )
    expect(
      compile(schema.form.where(form => sql<boolean>`${form.id} IN ${residues}`).select("id")),
    ).toEndWith(`WHERE "form"."id" IN (${statement})`)
  })

  it("takes the node of the lowered projection for a key of a selected field that holds a query, to group by its position", () => {
    const value = schema.field
      .select(field => ({
        name: field.form.get("id").expr(),
        fieldCount: count(),
      }))
      .groupBy((_field, selected) => selected.name)
    const aggregate = schema.form
      .select(form => ({
        size: form.fields.count(),
        forms: count(),
      }))
      .groupBy((_form, selected) => selected.size)

    expect(compile(value)).toEndWith(' FROM "form_field" AS "form_field" GROUP BY 1')
    expect(compile(aggregate)).toEndWith(' FROM "form" AS "form" GROUP BY 1')
  })

  it("keeps the keys and the condition of the groups in EXISTS", () => {
    const groups = schema.field.groupBy("formId").having(() => count().gt(1))

    expect(compile(groups.exists())).toBe(
      'SELECT EXISTS (SELECT FROM "form_field" AS "form_field" GROUP BY "form_field"."formId" HAVING count(*) > $1) AS "exists"',
    )
    expect(compile(schema.form.where(() => groups.exists()).select("id"))).toEndWith(
      'WHERE EXISTS (SELECT FROM "form_field" AS "form_field" GROUP BY "form_field"."formId" HAVING count(*) > $1)',
    )
  })

  it("reads the groups of an aggregate method from a derived source, also with a limit, an order, and a fallback", () => {
    const groups = schema.field.groupBy("formId").having(() => count().gt(1))

    expect(compile(groups.count())).toBe(
      'SELECT count(*) AS "count" FROM (SELECT FROM "form_field" AS "form_field" GROUP BY "form_field"."formId" HAVING count(*) > $1) AS "subquery"',
    )
    expect(compile(groups.max(field => sum(field.id)))).toBe(
      'SELECT max("subquery"."value") AS "max" FROM (SELECT sum("form_field"."id") AS "value" FROM "form_field" AS "form_field" GROUP BY "form_field"."formId" HAVING count(*) > $1) AS "subquery"',
    )
    expect(
      compile(
        groups
          .orderBy("formId")
          .limit(2)
          .max(field => sum(field.id))
          .coalesce(0),
      ),
    ).toBe(
      'SELECT coalesce(max("subquery"."value"), $1) AS "max" FROM (SELECT sum("form_field"."id") AS "value", "form_field"."formId" AS "$order1" FROM "form_field" AS "form_field" GROUP BY 2 HAVING count(*) > $2 ORDER BY 2 LIMIT $3) AS "subquery"',
    )
  })

  it("evaluates a nested query of a page of groups after an offset on its table", () => {
    const page = schema.form
      .groupBy("id")
      .orderBy("id")
      .offset(1)
      .select(form => ({
        labels: form.fields.pluck("label"),
      }))

    expect(compile(page)).toEndWith(
      ' FROM "form" AS "form" GROUP BY "form"."id" ORDER BY "form"."id" OFFSET $1',
    )
  })

  it("selects in the derived page of a parent the column that only the condition or the keys of the groups of a nested query read", () => {
    const page = schema.field.offset(1).select(field => ({
      readInCondition: field.options
        .groupBy("fieldId")
        .having(() => count().gt(field.formId))
        .pluck("fieldId"),
      readInKey: field.options.groupBy(() => field.label).count(),
    }))

    expect(compile(page)).toEndWith(
      'FROM (SELECT "form_field_2"."id" AS "id", "form_field_2"."formId" AS "formId", "form_field_2"."label" AS "label" FROM "form_field" AS "form_field_2" OFFSET $1) AS "form_field"',
    )
  })

  it("takes SELECT DISTINCT over the groups", () => {
    expect(compile(totals.distinct().orderBy((_field, selected) => selected.fieldCount))).toBe(
      'SELECT DISTINCT "form_field"."formId" AS "formId", count(*) AS "fieldCount" FROM "form_field" AS "form_field" GROUP BY 1 ORDER BY 2',
    )
  })
})

describe("query of distinct", () => {
  const compile = (query: AnySelectQuery) => compileStatement(lowerStatement(query.node)).text

  it("sorts by the positions of its projections, also as a subquery, whose repeated sort expression would get parameters of its own", () => {
    const shifted = schema.field
      .pluck(field => sql(t.integer)`${field.id} + ${1}`)
      .distinct()
      .orderBy((_field, value) => desc(value))
      .limit(2)
    const subquery =
      'SELECT DISTINCT "form_field"."id" + $1 AS "value" FROM "form_field" AS "form_field" ORDER BY 1 DESC LIMIT $2'

    expect(compile(shifted)).toBe(subquery)
    expect(compile(schema.form.where(form => form.id.in(shifted)))).toBe(
      `SELECT FROM "form" AS "form" WHERE "form"."id" IN (${subquery})`,
    )
    expect(compile(schema.form.where(form => form.id.eq(shifted.take())))).toBe(
      `SELECT FROM "form" AS "form" WHERE "form"."id" = (${subquery.replace("LIMIT $2", "LIMIT 1")})`,
    )
    expect(compile(schema.form.where(form => sql<boolean>`${form.id} IN ${shifted}`))).toBe(
      `SELECT FROM "form" AS "form" WHERE "form"."id" IN (${subquery})`,
    )
  })

  it("compares the values of fields of an aggregate and of exists, also of a page after an offset, which stays on its table", () => {
    const { node } = schema.form
      .select(form => ({
        fieldCount: form.fields.count(),
        hasFields: form.fields.exists(),
      }))
      .distinct()
      .orderBy((_form, selected) => selected.fieldCount)
      .offset(1)

    expect(compileStatement(lowerStatement(node)).text).toBe(
      'SELECT DISTINCT (SELECT count(*) AS "count" FROM "form_field" AS "form_field" WHERE "form_field"."formId" = "form"."id") AS "fieldCount", EXISTS (SELECT FROM "form_field" AS "form_field_2" WHERE "form_field_2"."formId" = "form"."id") AS "hasFields" FROM "form" AS "form" ORDER BY 1 OFFSET $1',
    )
  })

  it("rejects a query without fields that SQL selects, which PostgreSQL has no syntax for", () => {
    const message =
      "distinct requires at least one selected column or SQL expression; literal fields are not compared"

    for (const { node } of [
      schema.form.distinct(),
      schema.form.select("id").distinct().clearSelect(),
      schema.form
        .select(() => ({
          kind: literal("form"),
        }))
        .distinct(),
    ]) {
      expect(() => lowerStatement(node)).toThrow(message)
      expect(() => lowerQuery(node)).toThrow(message)
    }
  })

  it("rejects nested rows, which are JSON, at any depth, also of a converted aggregate", () => {
    const message = (key: string) =>
      `distinct cannot compare the nested rows of the selected field "${key}"`

    expect(() =>
      lowerStatement(
        schema.form
          .select(form => ({
            labels: form.fields.pluck("label"),
          }))
          .distinct().node,
      ),
    ).toThrow(message("labels"))
    expect(() =>
      lowerStatement(
        schema.form
          .select(form => ({
            fieldCount: form.fields.count().map(String),
          }))
          .distinct().node,
      ),
    ).toThrow(message("fieldCount"))
    expect(() =>
      lowerStatement(
        schema.form.select(form => ({
          fields: form.fields
            .select(field => ({
              values: field.options.pluck("fieldId"),
            }))
            .distinct(),
        })).node,
      ),
    ).toThrow(message("values"))
  })

  it("rejects a sort key that it does not select, also when nested, where packing would compare it too", () => {
    const message =
      "A query of distinct sorts only by its selected fields, since duplicates can differ in any other value; select the value to sort by it"
    const labels = schema.field.pluck("label").distinct()
    const upper = schema.field.pluck(field => sql(t.text)`upper(${field.label})`).distinct()

    expect(() => lowerStatement(labels.orderBy("id").node)).toThrow(message)
    // Only the same node is sure to have the value of the sort expression.
    expect(() =>
      lowerStatement(upper.orderBy(field => sql(t.text)`upper(${field.label})`).node),
    ).toThrow(message)
    expect(() =>
      lowerStatement(
        schema.form.select(form => ({
          labels: form.fields.pluck("label").distinct().orderBy("id"),
        })).node,
      ),
    ).toThrow(message)
    expect(() =>
      lowerStatement(
        schema.form.where(form => form.id.in(schema.field.pluck("id").distinct().orderBy("label")))
          .node,
      ),
    ).toThrow(message)
  })
})

describePostgres("in PostgreSQL", ({ database, testTransaction, useTestFixture }) => {
  useTestFixture(() =>
    database.script(`
      CREATE TABLE form (id integer);
      INSERT INTO form SELECT generate_series(1, 20);
    `),
  )

  const db = database.bind(defineSchema({ form }))

  const amount = defineTable("amount", {
    big: t.bigint,
    exact: t.numeric,
  })

  const amountDb = database.bind(defineSchema({ amount }))

  it("sorts an executed query by the values of a selected expression, evaluated once", async () => {
    const query = db.form
      .select(() => ({
        number: sql(t.integer)`nextval('number_sequence')::integer + ${0}`,
      }))
      .orderBy((_form, selected) => desc(selected.number))
    const { rows, evaluations } = await testTransaction(async () => {
      // A generic plan keeps parameters, so PostgreSQL would evaluate the expression repeated in `ORDER BY` with a parameter of its own again.
      await database.script(`
        SET LOCAL plan_cache_mode = force_generic_plan;
        CREATE SEQUENCE number_sequence;
      `)
      const rows = await db.$execute(query)
      const evaluations = await database.query`SELECT currval('number_sequence')`.get(t.integer)
      return { rows, evaluations }
    })

    expect(rows.map(row => row.number)).toEqual(
      Array.from({ length: 20 }, (_, index) => 20 - index),
    )
    expect(evaluations).toBe(20)
  })

  it("evaluates a selected sort expression once for each row and nested queries only for the rows of a page after an offset", async () => {
    const query = db.form
      .select(form => ({
        number: sql(t.integer)`nextval('number_sequence')::integer + ${0}`,
        nested: db.form
          .where(other => other.id.eq(form.id))
          .get(() => sql(t.integer)`nextval('nested_sequence')::integer`),
      }))
      .orderBy((_form, selected) => desc(selected.number))
      .limit(5)
      .offset(10)
    const { rows, evaluations } = await testTransaction(async () => {
      await database.script(`
        SET LOCAL plan_cache_mode = force_generic_plan;
        CREATE SEQUENCE number_sequence;
        CREATE SEQUENCE nested_sequence;
      `)
      const rows = await db.$execute(query)
      const evaluations = await database.query`
        SELECT currval('number_sequence') AS number, currval('nested_sequence') AS nested
      `
        .select({
          number: t.integer,
          nested: t.integer,
        })
        .take()
      return { rows, evaluations }
    })

    expect(rows.map(row => row.number)).toEqual([10, 9, 8, 7, 6])
    expect(rows.map(row => row.nested).toSorted((a, b) => a - b)).toEqual([1, 2, 3, 4, 5])
    expect(evaluations).toEqual({ number: 20, nested: 5 })
  })

  it("sorts by a selected field of an aggregate evaluated once for each row, also of a page after an offset with nested queries", async () => {
    const sorted = db.form
      .select(form => ({
        number: db.form
          .where(other => other.id.eq(form.id))
          .max(() => sql(t.integer)`nextval('number_sequence')::integer + ${0}`),
      }))
      .orderBy((_form, selected) => desc(selected.number))
    const page = sorted
      .select(form => ({
        nested: db.form
          .where(other => other.id.eq(form.id))
          .get(() => sql(t.integer)`nextval('nested_sequence')::integer`),
      }))
      .limit(5)
      .offset(10)
    const { rows, pageRows, evaluations } = await testTransaction(async () => {
      await database.script(`
        SET LOCAL plan_cache_mode = force_generic_plan;
        CREATE SEQUENCE number_sequence;
        CREATE SEQUENCE nested_sequence;
      `)
      const rows = await db.$execute(sorted)
      await database.script("ALTER SEQUENCE number_sequence RESTART")
      const pageRows = await db.$execute(page)
      const evaluations = await database.query`
        SELECT currval('number_sequence') AS number, currval('nested_sequence') AS nested
      `
        .select({
          number: t.integer,
          nested: t.integer,
        })
        .take()
      return { rows, pageRows, evaluations }
    })

    expect(rows.map(row => row.number)).toEqual(
      Array.from({ length: 20 }, (_, index) => 20 - index),
    )
    expect(pageRows.map(row => row.number)).toEqual([10, 9, 8, 7, 6])
    expect(evaluations).toEqual({ number: 20, nested: 5 })
  })

  it("evaluates window functions of a page after an offset over all its rows, also of a nested page", async () => {
    const page = db.form
      .orderBy("id")
      .limit(2)
      .offset(2)
      .select(form => ({
        id: form.id,
        number: sql(t.integer)`row_number() OVER (ORDER BY ${form.id})`,
        total: sql(t.integer)`count(*) OVER ()`,
        same: db.form.where(other => other.id.eq(form.id)).pluck("id"),
      }))
    const nested = db.form.where({ id: 1 }).select(() => ({
      page,
    }))
    const rows = [
      { id: 3, number: 3, total: 20, same: [3] },
      { id: 4, number: 4, total: 20, same: [4] },
    ]

    expect(await testTransaction(async () => [await page, await nested])).toStrictEqual([
      rows,
      [{ page: rows }],
    ])
  })

  it("selects an aggregate of a SQL fragment beside an independent nested query of a page after an offset", async () => {
    const select = (query: typeof db.form) =>
      query.select(() => ({
        total: sql(t.integer)`count(*)`,
        other: db.form.count(),
      }))
    const totals = [{ total: 20, other: 20 }]

    const results = await testTransaction(async () => [
      await select(db.form.offset(0)),
      await select(db.form.offset(1)),
      await select(db.form.limit(0).offset(0)),
      await db.form.where({ id: 1 }).select(() => ({
        page: select(db.form.offset(0)),
      })),
    ])

    expect(results).toStrictEqual([totals, [], [], [{ page: totals }]])
  })

  it("aggregates the rows of a query in a SQL fragment of a nested query before its offset", async () => {
    const select = (query: typeof db.form) =>
      query.select(form => ({
        nested: db.form.where({ id: 1 }).select(child => ({
          total: sql(t.integer)`sum(${form.id})`,
          mixed: sql(t.integer)`sum(${form.id}) + ${child.id}`,
          composed: sql(t.integer)`${sql(t.integer)`sum(${form.id})`} + ${child.id}`,
        })),
      }))

    const results = await testTransaction(async () => [
      await select(db.form.offset(0)),
      await select(db.form.offset(1)),
    ])

    expect(results).toStrictEqual([[{ nested: [{ total: 210, mixed: 211, composed: 211 }] }], []])
  })

  it("aggregates the rows of a query before its offset in an aggregate of its column in a nested query", async () => {
    const select = (query: typeof db.form) =>
      query.select(form => ({
        nested: db.form.where({ id: 1 }).select(() => ({
          total: sum(form.id),
        })),
      }))

    const results = await testTransaction(async () => [
      await select(db.form.offset(0)),
      await select(db.form.offset(1)),
    ])

    expect(results).toStrictEqual([[{ nested: [{ total: 210 }] }], []])
  })

  it("aggregates the rows of a query before its offset through a query in the argument of an aggregate", async () => {
    const select = (query: typeof db.form) =>
      query.select(form => ({
        nested: db.form.where({ id: 1 }).select(() => ({
          total: count(db.form.where({ id: 1 }).get(() => form.id)),
        })),
      }))

    const results = await testTransaction(async () => [
      await select(db.form.offset(0)),
      await select(db.form.offset(1)),
    ])

    expect(results).toStrictEqual([[{ nested: [{ total: 20 }] }], []])
  })

  it("aggregates the rows of a query before its offset through a query in a SQL fragment of a nested query", async () => {
    const select = (query: typeof db.form) =>
      query.select(form => ({
        nested: db.form.where({ id: 1 }).select(() => ({
          total: sql(t.integer)`count(${db.form.where({ id: 1 }).get(() => form.id)})`,
        })),
      }))

    const results = await testTransaction(async () => [
      await select(db.form.offset(0)),
      await select(db.form.offset(1)),
    ])

    expect(results).toStrictEqual([[{ nested: [{ total: 20 }] }], []])
  })

  describe("query of groups", () => {
    const residue = (form: { id: AnyExpression<number> }) => sql(t.integer)`${form.id} % ${3}`
    it("takes a query of the values of a parameterized expression, grouped and sorted by its value, in IN, after take, and in SQL text", async () => {
      const residues = db.form
        .pluck(residue)
        .groupBy((_form, value) => value)
        .orderBy((_form, value) => desc(value))

      const results = await testTransaction(async () => ({
        executed: await residues,
        inList: await db.form
          .where(form => form.id.in(residues))
          .orderBy("id")
          .pluck("id"),
        scalar: await db.form.where(form => form.id.eq(residues.take())).pluck("id"),
        text: await db.form
          .where(form => sql<boolean>`${form.id} IN ${residues}`)
          .orderBy("id")
          .pluck("id"),
      }))

      expect(results).toStrictEqual({
        executed: [2, 1, 0],
        inList: [1, 2],
        scalar: [2],
        text: [1, 2],
      })
    })

    it("groups a nested query by a parameterized bucket that a literal replaces, by the position of its sort key, and rejects it as an executed query, which has no such projection", async () => {
      const buckets = db.form
        .select(form => ({
          bucket: residue(form),
          total: count(),
        }))
        .groupBy((_form, selected) => selected.bucket)
        .orderBy((_form, selected) => selected.bucket)
        .select(() => ({
          bucket: literal("replaced"),
        }))

      const page = await testTransaction(async () => await db.$select({ rows: buckets }))

      expect(page).toStrictEqual({
        rows: [
          { bucket: "replaced", total: 6 },
          { bucket: "replaced", total: 7 },
          { bucket: "replaced", total: 7 },
        ],
      })
      await expect(testTransaction(async () => await buckets)).rejects.toThrow(
        "must appear in the GROUP BY clause",
      )
    })

    it("groups by a selected correlated query by its position, and rejects one that a literal replaces, whose key and sort key are lowered apart", async () => {
      const buckets = db.form
        .select(form => ({
          bucket: db.form
            .where(other => other.id.eq(form.id))
            .get(other => sql(t.integer)`${other.id} % 3`)
            .expr(),
          total: count(),
        }))
        .groupBy((_form, selected) => selected.bucket)
        .orderBy((_form, selected) => selected.bucket)

      const rows = await testTransaction(async () => await buckets)

      expect(rows).toStrictEqual([
        { bucket: 0, total: 6 },
        { bucket: 1, total: 7 },
        { bucket: 2, total: 7 },
      ])
      const replaced = buckets.select(() => ({
        bucket: literal("replaced"),
      }))
      await expect(
        testTransaction(async () => await db.$select({ rows: replaced })),
      ).rejects.toThrow("subquery uses ungrouped column")
    })
  })

  describe("query of distinct", () => {
    const residue = (form: { id: AnyExpression<number> }) => sql(t.integer)`${form.id} % ${3}`
    const residues = db.form
      .pluck(residue)
      .distinct()
      .orderBy((_form, value) => desc(value))

    it("removes the duplicates of the values and the records of an executed query, in its order", async () => {
      const results = await testTransaction(async () => ({
        values: await residues,
        page: await residues.offset(1).limit(1),
        first: await residues.take(),
        records: await db.form
          .select(form => ({
            residue: residue(form),
            kind: literal("residue"),
          }))
          .distinct()
          .orderBy((_form, selected) => selected.residue),
      }))

      expect(results).toEqual({
        values: [2, 1, 0],
        page: [1],
        first: 2,
        records: [
          { residue: 0, kind: "residue" },
          { residue: 1, kind: "residue" },
          { residue: 2, kind: "residue" },
        ],
      })
    })

    it("removes the duplicates of the values of in and of a subquery, sorted by an expression with parameters", async () => {
      const results = await testTransaction(async () => ({
        in: await db.form
          .where(form => form.id.in(residues))
          .orderBy("id")
          .pluck("id"),
        page: await db.form.where(form => form.id.in(residues.limit(1))).pluck("id"),
        scalar: await db.form.where(form => form.id.eq(residues.take())).pluck("id"),
        text: await db.form
          .where(form => sql<boolean>`${form.id} IN ${residues.limit(1)}`)
          .pluck("id"),
      }))

      expect(results).toEqual({ in: [1, 2], page: [2], scalar: [2], text: [2] })
    })

    it("removes the duplicates of nested rows in their order, also of a page", async () => {
      const query = db.form
        .where({ id: 5 })
        .select(form => {
          const others = db.form.where(other => other.id.lte(form.id))
          const values = others
            .pluck(residue)
            .distinct()
            .orderBy((_other, value) => desc(value))
          return {
            values,
            page: values.limit(1),
            records: others
              .select(other => ({
                residue: residue(other),
              }))
              .distinct()
              .orderBy((_other, selected) => selected.residue),
          }
        })
        .take()

      expect(await testTransaction(async () => await query)).toEqual({
        values: [2, 1, 0],
        page: [2],
        records: [{ residue: 0 }, { residue: 1 }, { residue: 2 }],
      })
    })

    it("keeps the rows mode of a nested query, also without a limit", async () => {
      const query = db.form
        .where({ id: 5 })
        .select(form => {
          const others = db.form.where(other => other.id.lte(form.id))
          const records = others
            .select(other => ({
              residue: residue(other),
            }))
            .distinct()
            .orderBy((_other, selected) => desc(selected.residue))
          const missing = others.where(other => other.id.gt(20))
          return {
            first: records.take(),
            value: others
              .pluck(residue)
              .distinct()
              .orderBy((_other, value) => desc(value))
              .take(),
            found: db.form.pluck(residue).distinct().find(5),
            optional: missing.pluck(residue).distinct().take().optional(),
            nullable: missing
              .select(other => ({
                residue: residue(other),
              }))
              .distinct()
              .take()
              .nullable(),
          }
        })
        .take()

      expect(await testTransaction(async () => await query)).toStrictEqual({
        first: { residue: 2 },
        value: 2,
        found: 2,
        optional: undefined,
        nullable: null,
      })
    })

    it("rejects without the row of a nested query of one row", async () => {
      const query = db.form
        .where({ id: 5 })
        .select(() => ({
          required: db.form
            .where(other => other.id.gt(20))
            .pluck(residue)
            .distinct()
            .take(),
        }))
        .take()

      await expect(testTransaction(async () => await query)).rejects.toThrow(NotFoundError)
    })

    it("gives its distinct rows in the fields of $select and in RETURNING of a mutation", async () => {
      const results = await testTransaction(async () => ({
        record: await db.$select({
          values: residues,
          first: residues.take(),
        }),
        returned: await db.form
          .where({ id: 1 })
          .update({ id: 1 })
          .pluck(() => residues.take()),
        nested: await db.form
          .where({ id: 1 })
          .update({ id: 1 })
          .select(() => ({
            values: residues,
          })),
      }))

      expect(results).toEqual({
        record: { values: [2, 1, 0], first: 2 },
        returned: [2],
        nested: [{ values: [2, 1, 0] }],
      })
    })

    it("chooses a page after an offset among the distinct rows, comparing a field of an aggregate", async () => {
      const rows = await testTransaction(
        async () =>
          await db.form
            .select(form => ({
              residue: residue(form),
              count: db.form.where(other => other.id.eq(form.id)).count(),
            }))
            .distinct()
            .orderBy((_form, selected) => selected.residue)
            .limit(1)
            .offset(1),
      )

      expect(rows).toEqual([{ residue: 1, count: 1 }])
    })
  })

  it("counts the rows that the filters choose, also of a page", async () => {
    const counts = await testTransaction(async () => [
      await db.form.count(),
      await db.form.where(form => form.id.gt(15)).count(),
      await db.form.limit(5).offset(18).count(),
      await db.form
        .where(form => form.id.gt(15))
        .limit(3)
        .count(),
    ])

    expect(counts).toEqual([20, 5, 2, 3])
  })

  it("tells whether a query has a row, also of a page", async () => {
    const results = await testTransaction(async () => [
      await db.form.exists(),
      await db.form.where(form => form.id.gt(20)).exists(),
      await db.form.offset(19).exists(),
      await db.form.offset(20).exists(),
      await db.form.limit(0).exists(),
    ])

    expect(results).toEqual([true, false, true, false, false])
  })

  it("aggregates the values that the filters choose, also of a page in the order of the query", async () => {
    const text = (form: { id: AnyExpression<number> }) => sql(t.text)`${form.id}::text`
    const missing = db.form.where(form => form.id.gt(20))
    const aggregates = await testTransaction(
      async () =>
        await db.$select({
          min: db.form.min("id"),
          max: db.form.where(form => form.id.lt(15)).max("id"),
          sum: db.form.sum("id"),
          average: db.form.avg("id"),
          lastSum: db.form.orderBy({ id: "desc" }).limit(3).sum("id"),
          firstSum: db.form.orderBy("id").limit(3).sum("id"),
          every: db.form.every(form => form.id.gt(1)),
          some: db.form.some(form => form.id.gt(19)),
          remainders: db.form.countDistinct(form => sql(t.integer)`${form.id} % 3`),
          ids: db.form
            .where(form => form.id.lte(3))
            .orderBy({ id: "desc" })
            .stringAgg(text, ","),
          lastIds: db.form.orderBy({ id: "desc" }).limit(3).stringAgg(text, ","),
          missingMax: missing.max("id"),
          missingSum: missing.sum("id"),
          missingCount: missing.count("id"),
          missingSumOrZero: missing.sum("id").coalesce(0),
          pageCountOrZero: db.form.limit(2).count().coalesce(0),
        }),
    )

    expect(aggregates).toEqual({
      min: 1,
      max: 14,
      sum: 210,
      average: 10.5,
      lastSum: 57,
      firstSum: 6,
      every: false,
      some: true,
      remainders: 3,
      ids: "3,2,1",
      lastIds: "20,19,18",
      missingMax: null,
      missingSum: null,
      missingCount: 0,
      missingSumOrZero: 0,
      pageCountOrZero: 2,
    })
  })

  it("decodes the sum of bigint and numeric values exactly, also of a fallback, and the average of bigint values by the type of an expression", async () => {
    const aggregates = await testTransaction(async () => {
      await database.script(`
        CREATE TABLE amount (big bigint, exact numeric);
        INSERT INTO amount VALUES (9007199254740993, 1.10), (2, 2.25);
      `)
      const missing = amountDb.amount.where(amount => amount.big.lt(0))
      return await amountDb.$select({
        bigSum: amountDb.amount.sum("big"),
        bigAverage: amountDb.amount.avg(amount => sql(t.doublePrecision)`${amount.big}`),
        exactSum: amountDb.amount.sum("exact"),
        exactAverage: amountDb.amount.avg("exact"),
        missingBigSum: missing.sum("big").coalesce(0),
        missingExactSum: missing.sum("exact").coalesce(0),
      })
    })

    expect(aggregates).toEqual({
      bigSum: 9007199254740995n,
      bigAverage: 4503599627370497.5,
      exactSum: "3.35",
      exactAverage: "1.6750000000000000",
      missingBigSum: 0n,
      missingExactSum: "0",
    })
  })
})
