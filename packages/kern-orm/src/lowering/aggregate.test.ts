import { describe, expect, it } from "bun:test"

import { describePostgres } from "../../testing/postgres"
import { compileStatement } from "../compiler/postgres/compile"
import { count, sum } from "../expression/aggregates"
import type { AnyExpression } from "../expression/expression"
import { and } from "../expression/predicates"
import { sql } from "../expression/sql"
import type { AnySelectQuery } from "../query/select"
import { many, one } from "../schema/relation"
import { defineSchema } from "../schema/schema"
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

it("replaces the queries in the argument and the fallbacks of an aggregate", () => {
  const { node } = schema.form
    .every(form => and(schema.field.where(field => field.formId.eq(form.id)).exists()))
    .coalesce(and(schema.field.exists()))

  expect(compileStatement(lowerQuery(node)).text).toBe(
    'SELECT coalesce(bool_and("subquery"."value"), EXISTS (SELECT FROM "form_field" AS "form_field")) AS "every" FROM (SELECT EXISTS (SELECT FROM "form_field" AS "form_field_2" WHERE "form_field_2"."formId" = "form"."id") AS "value" FROM "form" AS "form") AS "subquery"',
  )
})

describe("query of groups", () => {
  const compile = (query: AnySelectQuery) => compileStatement(lowerStatement(query.node)).text

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
      // The double nearest to the average, 4503599627370497.5.
      bigAverage: 4503599627370498,
      exactSum: "3.35",
      exactAverage: "1.6750000000000000",
      missingBigSum: 0n,
      missingExactSum: "0",
    })
  })
})
