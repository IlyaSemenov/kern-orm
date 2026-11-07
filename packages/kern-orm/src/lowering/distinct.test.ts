import { describe, expect, it } from "bun:test"

import { describePostgres } from "../../testing/postgres"
import { compileStatement } from "../compiler/postgres/compile"
import { count } from "../expression/aggregates"
import type { AnyExpression, TypedExpression } from "../expression/expression"
import { sql } from "../expression/sql"
import { literal } from "../query/literal"
import { desc } from "../query/order"
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

describe("query of distinct", () => {
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

  describe("aggregates and exists", () => {
    const compile = (query: AnySelectQuery) => compileStatement(lowerStatement(query.node)).text
    const labels = schema.field.select("formId", "label").distinct()

    it("read the distinct rows of the fields selected before them from a derived source, with the filters, the groups, the limit, and the offset, without the order of count and exists", () => {
      const distinctLabels =
        'SELECT DISTINCT "form_field"."formId" AS "formId", "form_field"."label" AS "label" FROM "form_field" AS "form_field"'

      expect(compile(labels.count())).toBe(
        `SELECT count(*) AS "count" FROM (${distinctLabels}) AS "subquery"`,
      )
      expect(labels.orderBy("label").limit(2).offset(1).count().where({ id: 1 }).toSQL()).toEqual({
        text: `SELECT count(*) AS "count" FROM (${distinctLabels} WHERE "form_field"."id" = $1 LIMIT $2 OFFSET $3) AS "subquery"`,
        parameters: ["1", "2", "1"],
      })
      expect(compile(labels.orderBy("label").offset(1).exists())).toBe(
        `SELECT EXISTS (${distinctLabels} OFFSET $1) AS "exists"`,
      )
      expect(
        compile(
          schema.field
            .groupBy("formId")
            .having(() => count().gt(1))
            .select(field => ({
              formId: field.formId,
              fields: count(),
            }))
            .distinct()
            .count(),
        ),
      ).toBe(
        'SELECT count(*) AS "count" FROM (SELECT DISTINCT "form_field"."formId" AS "formId", count(*) AS "fields" FROM "form_field" AS "form_field" GROUP BY 1 HAVING count(*) > $1) AS "subquery"',
      )
    })

    it("aggregate a selected column, or a selected expression that holds a query through its node, by its projection, sorted by the order of the query", () => {
      expect(
        compile(
          schema.field
            .pluck("label")
            .distinct()
            .orderBy({ label: "desc" })
            .limit(3)
            .stringAgg("label", ", "),
        ),
      ).toBe(
        'SELECT string_agg("subquery"."label", $1 ORDER BY "subquery"."label" DESC) AS "stringAgg" FROM (SELECT DISTINCT "form_field"."label" AS "label" FROM "form_field" AS "form_field" ORDER BY 1 DESC LIMIT $2) AS "subquery"',
      )
      let optionCount: TypedExpression<number> | undefined
      const optionCounts = schema.field
        .select(field => ({
          options: (optionCount = field.options.count().expr()),
        }))
        .distinct()
      expect(compile(optionCounts.sum(() => optionCount!))).toBe(
        'SELECT sum("subquery"."options") AS "sum" FROM (SELECT DISTINCT (SELECT count(*) AS "count" FROM "field_option" AS "field_option" WHERE "field_option"."fieldId" = "form_field"."id") AS "options" FROM "form_field" AS "form_field") AS "subquery"',
      )
    })

    it("reject an argument that the query does not select, wherever the query is", () => {
      const message =
        "An aggregate of a query of distinct reads only its selected fields, since duplicates can differ in any other value; select the value to aggregate it"
      const upper = (field: { label: AnyExpression<string> }) => sql(t.text)`upper(${field.label})`

      expect(() => lowerStatement(labels.max("id").node)).toThrow(message)
      expect(() => lowerQuery(labels.max("id").node)).toThrow(message)
      expect(() =>
        lowerStatement(
          schema.form.where(form => form.fields.select("label").distinct().max("id").expr().gt(1))
            .node,
        ),
      ).toThrow(message)
      // Only the same node is sure to have the value of the selected field.
      expect(() => lowerStatement(schema.field.pluck(upper).distinct().max(upper).node)).toThrow(
        message,
      )
    })

    it("check the query of the fields that they replace as the query is checked", () => {
      expect(() => lowerStatement(schema.form.distinct().count().node)).toThrow(
        "distinct requires at least one selected column or SQL expression; literal fields are not compared",
      )
      expect(() =>
        lowerStatement(
          schema.form
            .select(form => ({
              labels: form.fields.pluck("label"),
            }))
            .distinct()
            .exists().node,
        ),
      ).toThrow('distinct cannot compare the nested rows of the selected field "labels"')
      expect(() =>
        lowerStatement(schema.field.pluck("label").distinct().orderBy("id").count().node),
      ).toThrow(
        "A query of distinct sorts only by its selected fields, since duplicates can differ in any other value; select the value to sort by it",
      )
    })
  })
})

describe("query of distinctOn", () => {
  const compile = (query: AnySelectQuery) => compileStatement(lowerStatement(query.node)).text
  const message =
    "A query of distinctOn must sort by all its keys before any other value; sort by a key of an expression through its selected field"
  const keyed = schema.field.distinctOn("formId", "label").select("id")
  const bucket = (field: { id: AnyExpression<number> }) => sql(t.integer)`${field.id} % ${3}`
  const buckets = schema.field
    .select(field => ({
      bucket: bucket(field),
      id: field.id,
    }))
    .distinctOn((_field, selected) => selected.bucket)
    .orderBy((field, selected) => [selected.bucket, desc(field.id)])

  it("takes an order that sorts by all its keys first, in any order and direction, an order of only some keys, or none", () => {
    expect(compile(keyed.orderBy({ label: "desc" }, "formId", "id", "label"))).toBe(
      'SELECT DISTINCT ON ("form_field"."formId", "form_field"."label") "form_field"."id" AS "id" FROM "form_field" AS "form_field" ORDER BY "form_field"."label" DESC, "form_field"."formId", 1, "form_field"."label"',
    )
    expect(compile(keyed.orderBy("formId"))).toEndWith('ORDER BY "form_field"."formId"')
    expect(compile(keyed)).toBe(
      'SELECT DISTINCT ON ("form_field"."formId", "form_field"."label") "form_field"."id" AS "id" FROM "form_field" AS "form_field"',
    )
  })

  it("rejects an order that sorts by another value before all its keys, wherever the query is", () => {
    for (const order of [["id", "formId", "label"] as const, ["formId", "id"] as const]) {
      const query = keyed.orderBy(...order)
      expect(() => lowerStatement(query.node)).toThrow(message)
      expect(() => lowerQuery(query.node)).toThrow(message)
      expect(() =>
        lowerStatement(
          schema.form.select(form => ({
            fields: form.fields
              .distinctOn("formId", "label")
              .select("id")
              .orderBy(...order),
          })).node,
        ),
      ).toThrow(message)
      expect(() =>
        lowerStatement(schema.form.where(form => form.id.in(query.pluck("id"))).node),
      ).toThrow(message)
    }
    // Only the same node is sure to have the value of the key.
    expect(() =>
      lowerStatement(
        schema.field
          .select("id")
          .distinctOn(field => sql(t.text)`upper(${field.label})`)
          .orderBy(field => [sql(t.text)`upper(${field.label})`, field.id]).node,
      ),
    ).toThrow(message)
  })

  it("compiles a key of a selected expression with parameters and its sort key as the position of its projection, also as a subquery, and rejects them once the query no longer selects it, whose copies would have parameters of their own", () => {
    const text =
      'SELECT DISTINCT ON (1) "form_field"."id" % $1 AS "bucket", "form_field"."id" AS "id" FROM "form_field" AS "form_field" ORDER BY 1, 2 DESC'

    expect(compile(buckets)).toBe(text)
    expect(compile(schema.form.where(form => sql<boolean>`${form.id} IN ${buckets}`))).toBe(
      `SELECT FROM "form" AS "form" WHERE "form"."id" IN (${text})`,
    )
    for (const query of [
      buckets.clearSelect().select("id"),
      buckets.select(field => ({
        bucket: bucket(field),
      })),
    ]) {
      expect(() => lowerStatement(query.node)).toThrow(message)
      expect(() => lowerStatement(schema.$select({ rows: query }).node)).toThrow(message)
      expect(() =>
        lowerStatement(schema.form.where(form => form.id.in(query.pluck("id"))).node),
      ).toThrow(message)
    }
  })

  it("rejects a query without fields that SQL selects, which PostgreSQL has no syntax for", () => {
    const expected =
      "distinctOn requires at least one selected column or SQL expression; literal fields are not selected"

    for (const { node } of [
      schema.field.distinctOn("formId"),
      schema.field
        .select(() => ({
          kind: literal("field"),
        }))
        .distinctOn("formId"),
    ]) {
      expect(() => lowerStatement(node)).toThrow(expected)
      expect(() => lowerQuery(node)).toThrow(expected)
    }
  })

  describe("aggregates and exists", () => {
    const latest = schema.field.distinctOn("formId").orderBy("formId", { id: "desc" })

    it("read the first rows from a derived source that selects the keys and no other field, without the order of count and exists", () => {
      const firstRows =
        'SELECT DISTINCT ON (1) "form_field"."formId" AS "$key1" FROM "form_field" AS "form_field"'

      expect(compile(latest.count())).toBe(
        `SELECT count(*) AS "count" FROM (${firstRows}) AS "subquery"`,
      )
      expect(compile(latest.select("label").limit(2).count())).toBe(
        `SELECT count(*) AS "count" FROM (${firstRows} LIMIT $1) AS "subquery"`,
      )
      expect(compile(latest.offset(1).exists())).toBe(
        `SELECT EXISTS (${firstRows} OFFSET $1) AS "exists"`,
      )
    })

    it("aggregate a value of the first rows from a derived source sorted by positions, in the order of the query", () => {
      expect(compile(latest.sum("id"))).toBe(
        'SELECT sum("subquery"."value") AS "sum" FROM (SELECT DISTINCT ON (2) "form_field"."id" AS "value", "form_field"."formId" AS "$key1" FROM "form_field" AS "form_field" ORDER BY 2, 1 DESC) AS "subquery"',
      )
      expect(compile(latest.stringAgg("label", ", "))).toBe(
        'SELECT string_agg("subquery"."value", $1 ORDER BY "subquery"."$key1", "subquery"."$order2" DESC) AS "stringAgg" FROM (SELECT DISTINCT ON (2) "form_field"."label" AS "value", "form_field"."formId" AS "$key1", "form_field"."id" AS "$order2" FROM "form_field" AS "form_field" ORDER BY 2, 3 DESC) AS "subquery"',
      )
    })

    it("read a key and a sort key of a selected expression with parameters by its projection, and reject them once the query no longer selects it, or an order that sorts by another value first", () => {
      expect(buckets.max("id").toSQL()).toEqual({
        text: 'SELECT max("subquery"."value") AS "max" FROM (SELECT DISTINCT ON (2) "form_field"."id" AS "value", "form_field"."id" % $1 AS "$key1" FROM "form_field" AS "form_field" ORDER BY 2, 1 DESC) AS "subquery"',
        parameters: ["3"],
      })
      for (const query of [
        buckets.clearSelect().select("id").count(),
        keyed.orderBy("id", "formId", "label").exists(),
      ]) {
        expect(() => lowerStatement(query.node)).toThrow(message)
        expect(() => lowerStatement(schema.$select({ value: query }).node)).toThrow(message)
      }
    })

    it("read a key of the groups, a key, a sort key, and the argument of a selected expression that holds a query through its node by its one projection", () => {
      let optionCount: TypedExpression<number> | undefined
      const query = schema.field
        .select(field => ({
          options: (optionCount = field.options.count().expr()),
        }))
        .groupBy((_field, selected) => selected.options)
        .distinctOn((_field, selected) => selected.options)
        .orderBy((_field, selected) => selected.options)
        .max(() => optionCount!)

      expect(compile(query)).toBe(
        'SELECT max("subquery"."value") AS "max" FROM (SELECT DISTINCT ON (1) (SELECT count(*) AS "count" FROM "field_option" AS "field_option" WHERE "field_option"."fieldId" = "form_field"."id") AS "value" FROM "form_field" AS "form_field" GROUP BY 1 ORDER BY 1) AS "subquery"',
      )
    })
  })
})

describePostgres("in PostgreSQL", ({ database, testTransaction, useTestFixture }) => {
  useTestFixture(() =>
    database.script(`
      CREATE TABLE writer (id integer);
      INSERT INTO writer VALUES (1), (2), (3);
      CREATE TABLE entry (id integer, author integer, kind text);
      INSERT INTO entry VALUES
        (1, 1, 'a'), (2, 1, 'a'), (3, 1, 'b'),
        (4, 2, 'b'), (5, 2, 'b'), (6, 2, 'a'),
        (7, NULL, 'a'), (8, NULL, 'b'),
        (9, 3, 'a'), (10, 3, 'a');
    `),
  )

  const writer = defineTable("writer", {
    id: t.integer,
  })

  const entry = defineTable("entry", {
    id: t.integer,
    author: t.integer.nullable(),
    kind: t.text,
  })

  const db = database.bind(
    defineSchema({ writer, entry }).$relations({
      writer: {
        entries: many(entry, { from: "id", to: "author" }),
      },
    }),
  )

  it("aggregates the distinct rows of the selected fields, also of a page, of groups, nested, and in a condition", async () => {
    const pairs = db.entry.select("author", "kind").distinct()
    const authors = db.entry.pluck("author").distinct()
    const kinds = db.entry.pluck("kind").distinct()
    const busyAuthors = db.entry
      .groupBy("author")
      .having(() => count().gt(2))
      .pluck("author")
      .distinct()

    const results = await testTransaction(async () => ({
      pairs: await pairs.count(),
      page: await pairs.orderBy("author", "kind").limit(10).offset(3).count(),
      authorSum: await authors.sum("author"),
      kinds: await kinds.orderBy({ kind: "desc" }).stringAgg("kind", ","),
      pages: [await authors.offset(3).exists(), await authors.offset(4).exists()],
      busyAuthors: await busyAuthors.count(),
      busyPages: [await busyAuthors.offset(1).exists(), await busyAuthors.offset(2).exists()],
      writerKinds: await db.writer.orderBy("id").select(writer => ({
        id: writer.id,
        kinds: writer.entries.pluck("kind").distinct().count(),
      })),
      variedWriters: await db.writer
        .where(writer => writer.entries.pluck("kind").distinct().offset(1).exists())
        .orderBy("id")
        .pluck("id"),
    }))

    // Without distinct, the same calls give 10 pairs, a page of 7, a sum of 15, `b,b,b,b,a,a,a,a,a,a`, rows after both offsets, 3, 3, and 2 kinds of the writers, and the writers 1, 2, and 3; without having, 4 authors and rows after both offsets.
    expect(results).toEqual({
      pairs: 7,
      page: 4,
      authorSum: 6,
      kinds: "b,a",
      pages: [true, false],
      busyAuthors: 2,
      busyPages: [true, false],
      writerKinds: [
        { id: 1, kinds: 2 },
        { id: 2, kinds: 2 },
        { id: 3, kinds: 1 },
      ],
      variedWriters: [1, 2],
    })
  })

  it("aggregates the first rows of distinctOn in the order of the query, also of a page and nested", async () => {
    const latest = db.entry.distinctOn("author").orderBy("author", { id: "desc" })
    const text = (row: { id: AnyExpression<number> }) => sql(t.text)`${row.id}::text`

    const results = await testTransaction(async () => ({
      groups: await latest.count(),
      page: await latest.offset(1).limit(2).count(),
      lastPage: await latest.offset(3).limit(2).count(),
      latestSum: await latest.sum("id"),
      earliestSum: await db.entry.distinctOn("author").orderBy("author", "id").sum("id"),
      ids: await latest.stringAgg(text, ","),
      pages: [await latest.offset(3).exists(), await latest.offset(4).exists()],
      writerSums: await db.writer
        .orderBy("id")
        .pluck(writer =>
          writer.entries.distinctOn("kind").orderBy("kind", { id: "desc" }).sum("id"),
        ),
    }))

    // Without distinctOn, the same calls give 10 rows, pages of 2 rows, a sum of 55 in either order, `3,2,1,6,5,4,10,9,8,7`, rows after both offsets, and sums of 6, 15, and 19 of the writers.
    expect(results).toEqual({
      groups: 4,
      page: 2,
      lastPage: 1,
      latestSum: 27,
      earliestSum: 21,
      ids: "3,6,10,8",
      pages: [true, false],
      writerSums: [5, 11, 10],
    })
  })

  it("reads the key of the groups, the key, the sort key, and the argument of a selected expression that holds a query from one projection", async () => {
    let entryCount: TypedExpression<number> | undefined
    const query = db.writer
      .select(writer => ({
        entries: (entryCount = writer.entries.count().expr()),
      }))
      .groupBy((_writer, selected) => selected.entries)
      .distinctOn((_writer, selected) => selected.entries)
      .orderBy((_writer, selected) => selected.entries)
      .max(() => entryCount!)

    expect(await testTransaction(async () => await query)).toBe(3)
  })

  it("does not evaluate the fields of the first rows that an aggregate does not read", async () => {
    const numbered = db.entry
      .select(() => ({
        number: sql(t.integer)`nextval('number_sequence')::integer`,
        numbers: db.writer.select(() => ({
          number: sql(t.integer)`nextval('number_sequence')::integer`,
        })),
      }))
      .distinctOn("author")
    const isCalled = () => database.query`SELECT is_called FROM number_sequence`.get(t.boolean)

    const results = await testTransaction(async () => {
      await database.script("CREATE SEQUENCE number_sequence")
      const groups = await numbered.count()
      const calledByCount = await isCalled()
      await numbered
      return { groups, calledByCount, calledByRows: await isCalled() }
    })

    expect(results).toEqual({ groups: 4, calledByCount: false, calledByRows: true })
  })
})
