import { describe, expect, it } from "bun:test"

import { createRecordingDriver } from "@kern-orm/test-harness/recording-driver"
import { createDatabase, NotFoundError } from "kern-db"

import { describePostgres } from "../../testing/postgres"
import type { RawSqlNode } from "../ast/nodes"
import { compileStatement, compileTextStatement } from "../compiler/postgres/compile"
import { bindSchema } from "../execution/db"
import { count, sum } from "../expression/aggregates"
import type { AnyExpression } from "../expression/expression"
import { toNode } from "../expression/expression"
import { not, or } from "../expression/predicates"
import { param, sql } from "../expression/sql"
import { literal } from "../query/literal"
import { desc } from "../query/order"
import type { AnySelectQuery } from "../query/select"
import { collectDefinitions, many, one } from "../schema/relation"
import { defineSchema, schemaRelations } from "../schema/schema"
import { defineTable } from "../table/table"
import * as t from "../types"

import { lowerQuery, lowerStatement, lowerTextStatement } from "./lower"

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
    const db = bindSchema(schema, database)
    const { node } = schema.$select({
      fields: schema.field.select(field => ({
        options: field.options,
      })),
      forms: db.form,
    })

    expect(() => lowerStatement(node, collectDefinitions(forms[schemaRelations]))).toThrow(
      'Relation "field.options" is not part of the schema',
    )
    expect(() => lowerStatement(node, undefined, bindSchema(schema, database))).toThrow(
      'Selected field "forms" is bound to another Db',
    )
    expect(() =>
      lowerStatement(node, collectDefinitions(schema[schemaRelations]), db),
    ).not.toThrow()
  })
})

describe("lowerTextStatement", () => {
  it("replaces the queries in the expressions interpolated into a statement of SQL text, and rejects a query bound to another Db", () => {
    const database = createDatabase({ driver: createRecordingDriver().driver })
    const db = bindSchema(schema, database)
    const node = toNode(sql`SELECT ${not(db.form.exists())} AS "empty"`) as RawSqlNode

    expect(compileTextStatement(lowerTextStatement(node, undefined, db)).text).toBe(
      'SELECT (NOT EXISTS (SELECT FROM "form" AS "form")) AS "empty"',
    )
    expect(() => lowerTextStatement(node, undefined, bindSchema(schema, database))).toThrow(
      "bound to another Db",
    )
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

  it("takes SELECT DISTINCT over the groups", () => {
    expect(compile(totals.distinct().orderBy((_field, selected) => selected.fieldCount))).toBe(
      'SELECT DISTINCT "form_field"."formId" AS "formId", count(*) AS "fieldCount" FROM "form_field" AS "form_field" GROUP BY 1 ORDER BY 2',
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

  const db = bindSchema(defineSchema({ form }), database)

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

    it("groups by the position of the sort key of a parameterized bucket that a literal replaces, in a nested query and in an executed page of a derived source, and rejects it in another executed query, which has no such projection", async () => {
      const buckets = db.form
        .select(form => ({
          bucket: residue(form),
          total: sum(form.id),
        }))
        .groupBy((_form, selected) => selected.bucket)
        .orderBy((_form, selected) => selected.bucket)
        .select(() => ({
          bucket: literal("replaced"),
        }))
      const derived = buckets.offset(1).select(() => ({
        first: db.form.where({ id: 1 }).pluck("id"),
      }))

      const results = await testTransaction(async () => ({
        nested: await db.$select({ rows: buckets }),
        derived: await derived,
      }))

      expect(results).toStrictEqual({
        nested: {
          rows: [
            { bucket: "replaced", total: 63 },
            { bucket: "replaced", total: 70 },
            { bucket: "replaced", total: 77 },
          ],
        },
        derived: [
          { bucket: "replaced", total: 70, first: [1] },
          { bucket: "replaced", total: 77, first: [1] },
        ],
      })
      await expect(testTransaction(async () => await buckets)).rejects.toThrow(
        "must appear in the GROUP BY clause",
      )
    })

    it("reads a key with a parameter of param created once in having, also beside an aggregate under OR, and sorts by it without selecting it, but rejects its copy in a nested query", async () => {
      const three = param(t.integer, 3)
      const bucket = (form: { id: AnyExpression<number> }) => sql(t.integer)`${form.id} % ${three}`
      const totals = db.form
        .groupBy(bucket)
        .having(form => or(bucket(form).eq(1), count().lt(7)))
        .orderBy(form => desc(bucket(form)))
        .select(() => ({
          total: count(),
        }))
      const copies = db.form.groupBy(bucket).select(form => ({
        copy: db.form.where({ id: 1 }).get(() => bucket(form)),
      }))

      expect(await testTransaction(async () => await totals)).toStrictEqual([
        { total: 7 },
        { total: 6 },
      ])
      // PostgreSQL matches an expression with the keys only in the query of groups itself.
      await expect(testTransaction(async () => await copies)).rejects.toThrow(
        "subquery uses ungrouped column",
      )
    })

    it("binds a parameter without a cast at each place of a query of groups, whose type each place deduces", async () => {
      const value = sql`${"01"}`
      const rows = await testTransaction(
        async () =>
          await db.form
            .where({ id: 1 })
            .groupBy("id")
            .select(() => ({
              number: sql(t.integer)`${value}::integer`,
              text: sql(t.text)`${value}::text`,
            })),
      )

      expect(rows).toStrictEqual([{ number: 1, text: "01" }])
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

  describe("query of distinctOn", () => {
    const entry = defineTable("entry", {
      id: t.integer,
      author: t.integer.nullable(),
      kind: t.text,
    })
    const entryDb = bindSchema(defineSchema({ entry }), database)
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

    it("keeps the first row of each group in the order of the query, with NULL keys in one group, executed, as a page, of one row, in in, and nested", async () => {
      const results = await withEntries(async () => ({
        executed: await latest.select("author", "id"),
        page: await latest.offset(1).limit(1).pluck("id"),
        first: await latest.get("id"),
        inList: await entryDb.entry
          .where(other => other.id.in(latest.pluck("id")))
          .orderBy("id")
          .pluck("id"),
        nested: await entryDb.$select({
          ids: latest.pluck("id"),
          first: latest.select("kind").take(),
        }),
      }))

      expect(results).toStrictEqual({
        executed: [
          { author: 1, id: 3 },
          { author: 2, id: 6 },
          { author: null, id: 8 },
        ],
        page: [6],
        first: 3,
        inList: [3, 6, 8],
        nested: { ids: [3, 6, 8], first: { kind: "b" } },
      })
    })

    it("keeps the first group of each key of a query of groups, such as the most common kind of each author", async () => {
      const kinds = entryDb.entry
        .groupBy("author", "kind")
        .distinctOn("author")
        .orderBy(row => [row.author, desc(count()), row.kind])
        .select("author", "kind")

      expect(await withEntries(async () => await kinds)).toStrictEqual([
        { author: 1, kind: "a" },
        { author: 2, kind: "b" },
        { author: null, kind: "a" },
      ])
    })

    it("sorts by a selected key of an expression with parameters, executed, nested, and in SQL text", async () => {
      const residues = db.form
        .select(form => ({
          residue: sql(t.integer)`${form.id} % ${3}`,
          id: form.id,
        }))
        .distinctOn((_form, selected) => selected.residue)
        .orderBy((form, selected) => [selected.residue, desc(form.id)])

      const results = await testTransaction(async () => ({
        executed: await residues,
        nested: await db.$select({ rows: residues }),
        text: await db.form
          .where(form => sql<boolean>`${form.id} IN (SELECT r.id FROM ${residues} AS r)`)
          .orderBy("id")
          .pluck("id"),
      }))

      const rows = [
        { residue: 0, id: 18 },
        { residue: 1, id: 19 },
        { residue: 2, id: 20 },
      ]
      expect(results).toStrictEqual({ executed: rows, nested: { rows }, text: [18, 19, 20] })
    })
  })
})
