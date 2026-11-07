import { describe, expect, it } from "bun:test"

import { describePostgres } from "../../testing/postgres"
import { compileStatement } from "../compiler/postgres/compile"
import { count, every, sum } from "../expression/aggregates"
import { and, not } from "../expression/predicates"
import { sql } from "../expression/sql"
import { desc } from "../query/order"
import type { AnySelectQuery } from "../query/select"
import { many, one } from "../schema/relation"
import { defineSchema } from "../schema/schema"
import { defineTable } from "../table/table"
import * as t from "../types"

import { lowerStatement } from "./lower"

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

const compile = (query: AnySelectQuery) => compileStatement(lowerStatement(query.node)).text

describe("page after an offset", () => {
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

  it("derives a page after an offset only when the arguments and the filters of the aggregates of its nested queries read no column of its table", () => {
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
    const parentFilter = page.select(form => ({
      total: schema.field.select(() => ({
        count: count({ filter: form.id.isNull() }),
      })),
    }))
    const bothFilter = page.select(form => ({
      total: schema.field.select(field => ({
        count: count({ filter: field.id.eq(form.id) }),
      })),
    }))
    const ownColumn = page.select(form => ({
      total: form.fields.select(field => ({
        fields: count(),
        sum: sum(field.id),
        labelled: count({ filter: field.label.isNull() }),
      })),
    }))

    for (const query of [parentColumn, bothColumns, parentFilter, bothFilter]) {
      expect(compileStatement(lowerStatement(query.node)).text).toEndWith(
        ' FROM "form" AS "form" ORDER BY "form"."id" OFFSET $1',
      )
    }
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
})

describe("first rows of distinctOn", () => {
  it("reads the first rows of a query that selects nested queries from a derived source, which selects its keys and applies its page, and sorts them again", () => {
    const first = schema.field
      .distinctOn("formId")
      .orderBy("formId", { id: "desc" })
      .select(field => ({
        options: field.options.pluck("fieldId"),
      }))

    expect(compile(first)).toEndWith(
      ' FROM (SELECT DISTINCT ON (2) "form_field_2"."id" AS "id", "form_field_2"."formId" AS "$key1" FROM "form_field" AS "form_field_2" ORDER BY 2, 1 DESC) AS "form_field" ORDER BY "form_field"."$key1", "form_field"."id" DESC',
    )
    expect(compile(first.limit(2).offset(1))).toEndWith(
      ' FROM (SELECT DISTINCT ON (2) "form_field_2"."id" AS "id", "form_field_2"."formId" AS "$key1" FROM "form_field" AS "form_field_2" ORDER BY 2, 1 DESC LIMIT $1 OFFSET $2) AS "form_field" ORDER BY "form_field"."$key1", "form_field"."id" DESC',
    )
  })

  it("evaluates a field of an aggregate that is a key in the derived source of the first rows", () => {
    const first = schema.form
      .select(form => ({
        fieldCount: form.fields.count(),
        labels: form.fields.pluck("label"),
      }))
      .distinctOn((_form, selected) => selected.fieldCount)

    expect(compile(first)).toEndWith(
      ' FROM (SELECT DISTINCT ON (2) "form_2"."id" AS "id", (SELECT count(*) AS "count" FROM "form_field" AS "form_field_2" WHERE "form_field_2"."formId" = "form_2"."id") AS "$field1" FROM "form" AS "form_2") AS "form"',
    )
  })

  it("keeps the first rows of a query of groups and of a query whose nested query may aggregate its rows on its table", () => {
    expect(
      compile(
        schema.field
          .groupBy("formId")
          .distinctOn("formId")
          .select(field => ({
            form: field.form.select("id"),
          })),
      ),
    ).toEndWith(' FROM "form_field" AS "form_field" GROUP BY "form_field"."formId"')
    expect(
      compile(
        schema.field.distinctOn("formId").select(field => ({
          total: schema.form.get(() => sum(field.id)),
        })),
      ),
    ).toEndWith(' FROM "form_field" AS "form_field"')
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

  it("aggregates the rows of a query before its offset in the filter of an aggregate of a nested query, also through a query in the filter, and the rows of the nested query when the filter also reads them", async () => {
    const parent = (query: typeof db.form) =>
      query.select(form => ({
        nested: db.form.where({ id: 1 }).select(() => ({
          total: count({ filter: form.id.gt(10) }),
        })),
      }))
    const throughQuery = (query: typeof db.form) =>
      query.select(form => ({
        nested: db.form.where({ id: 1 }).select(() => ({
          total: count({
            filter: db.form
              .where({ id: 1 })
              .get(() => form.id)
              .expr()
              .gt(10),
          }),
        })),
      }))
    const both = (query: typeof db.form) =>
      query.orderBy("id").select(form => ({
        nested: db.form.where({ id: 1 }).select(child => ({
          total: count({ filter: and(form.id.gt(10), child.id.eq(1)) }),
        })),
      }))
    const totals = Array.from({ length: 20 }, (_, index) => ({
      nested: [{ total: index < 10 ? 0 : 1 }],
    }))

    const results = await testTransaction(async () => [
      await parent(db.form.offset(0)),
      await parent(db.form.offset(1)),
      await throughQuery(db.form.offset(0)),
      await throughQuery(db.form.offset(1)),
      await both(db.form.offset(0)),
      await both(db.form.offset(1)),
    ])

    expect(results).toStrictEqual([
      [{ nested: [{ total: 10 }] }],
      [],
      [{ nested: [{ total: 10 }] }],
      [],
      totals,
      totals.slice(1),
    ])
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

  describe("first rows of distinctOn", () => {
    const entry = defineTable("entry", {
      id: t.integer,
      author: t.integer.nullable(),
      kind: t.text,
    })
    const entryDb = database.bind(defineSchema({ entry }))
    /** Runs `callback` in a test transaction with entries of the authors `1`, `2`, and `NULL`, of the kinds `a` and `b`, whose ids grow with time. */
    const withEntries = <T>(callback: () => Promise<T>) =>
      testTransaction(async () => {
        await database.script(`
          CREATE TABLE entry (id integer, author integer, kind text);
          INSERT INTO entry VALUES
            (1, 1, 'a'), (2, 1, 'a'), (3, 1, 'b'),
            (4, 2, 'b'), (5, 2, 'b'), (6, 2, 'a'),
            (7, NULL, 'a'), (8, NULL, 'b');
        `)
        return await callback()
      })
    const latest = entryDb.entry.distinctOn("author").orderBy("author", { id: "desc" })

    it("evaluates the nested queries of the first rows once for each group, executed and nested", async () => {
      const numbered = latest.select(row => ({
        id: row.id,
        number: entryDb.entry
          .where(other => other.id.eq(row.id))
          .get(() => sql(t.integer)`nextval('nested_sequence')::integer`),
      }))
      const run = (execute: () => Promise<readonly { id: number }[]>) =>
        withEntries(async () => {
          await database.script("CREATE SEQUENCE nested_sequence")
          const rows = await execute()
          const evaluations = await database.query`SELECT currval('nested_sequence')`.get(t.integer)
          return { ids: rows.map(row => row.id), evaluations }
        })

      expect(await run(async () => await numbered)).toEqual({ ids: [3, 6, 8], evaluations: 3 })
      expect(await run(async () => (await entryDb.$select({ rows: numbered })).rows)).toEqual({
        ids: [3, 6, 8],
        evaluations: 3,
      })
    })
  })
})
