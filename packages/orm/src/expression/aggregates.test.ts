import { describe, expect, it } from "bun:test"

import { createRecordingDriver } from "@kern-orm/test-harness/recording-driver"
import { createDatabase, ResultDecodeError } from "kern-db"

import { describePostgres } from "../../testing/postgres"
import { bindSchema } from "../execution/db"
import { countType } from "../query/aggregate"
import { desc } from "../query/order"
import { from } from "../query/select"
import { createColumnRefs } from "../query/testing"
import { many } from "../schema/relation"
import { defineSchema } from "../schema/schema"
import { defineTable } from "../table/table"
import * as t from "../types"

import { avg, count, countDistinct, every, max, min, some, stringAgg, sum } from "./aggregates"
import { getType, toNode } from "./expression"
import { caseWhen, coalesce } from "./functions"
import { not } from "./predicates"
import { sql } from "./sql"

const scoreType = t.integer.transform({
  decode: value => ({ value }),
  encode: (score: { value: number }) => score.value,
})

const form = defineTable("form", {
  id: t.uuid.primaryKey(),
  name: t.text,
})

const field = defineTable("field", {
  id: t.uuid.primaryKey(),
  formId: t.uuid,
  position: t.integer,
  label: t.text.nullable(),
  required: t.boolean,
  size: t.bigint,
  score: scoreType,
})

const schema = defineSchema({ form, field }).$relations({
  form: { fields: many(field, { from: "id", to: "formId" }) },
})

describe("the SQL of an aggregate function", () => {
  it("calls the aggregate of its argument over the rows of the query, and count without one over all of them", () => {
    const query = from(field).select(field => ({
      total: count(),
      labelled: count(field.label),
      labels: countDistinct(field.label),
      first: min(field.position),
      last: max(field.position),
      positions: sum(field.position),
      average: avg(field.position),
      allRequired: every(field.required),
      anyRequired: some(field.required),
    }))

    expect(query.toSQL().text).toBe(
      'SELECT count(*) AS "total", count("field"."label") AS "labelled", count(DISTINCT "field"."label") AS "labels", min("field"."position") AS "first", max("field"."position") AS "last", sum("field"."position") AS "positions", avg("field"."position") AS "average", bool_and("field"."required") AS "allRequired", bool_or("field"."required") AS "anyRequired" FROM "field" AS "field"',
    )
  })

  it("takes an expression of the row, with its parameters in the order of the text", () => {
    const query = from(field)
      .where({ label: "where" })
      .select(field => ({
        selected: max(sql(t.integer)`${field.position} + ${1}`),
      }))

    expect(query.toSQL()).toEqual({
      text: 'SELECT max("field"."position" + $1) AS "selected" FROM "field" AS "field" WHERE "field"."label" = $2',
      parameters: ["1", "where"],
    })
  })

  it("takes a query of one value, which lowering replaces with a scalar subquery", () => {
    const query = schema.form.select(form => ({
      most: max(form.fields.count()),
    }))

    expect(query.toSQL().text).toBe(
      'SELECT max((SELECT count(*) AS "count" FROM "field" AS "field" WHERE "field"."formId" = "form"."id")) AS "most" FROM "form" AS "form"',
    )
  })

  it("takes a condition of its rows as FILTER after the call, also a query of one Boolean value, which lowering replaces", () => {
    const query = from(field).select(field => ({
      required: count({ filter: field.required }),
      labelled: count(field.label, { filter: field.position.gt(1) }),
      labels: countDistinct(field.label, { filter: field.required }),
      first: min(field.position, { filter: field.required }),
      last: max(field.position, { filter: field.required }),
      positions: sum(field.position, { filter: field.required }),
      average: avg(field.position, { filter: field.required }),
      allRequired: every(field.required, { filter: field.position.gt(2) }),
      anyRequired: some(field.required, { filter: field.position.gt(3) }),
    }))
    const nested = schema.form.select(form => ({
      withFields: count({ filter: form.fields.exists() }),
    }))

    expect(query.toSQL()).toEqual({
      text: 'SELECT count(*) FILTER (WHERE "field"."required") AS "required", count("field"."label") FILTER (WHERE "field"."position" > $1) AS "labelled", count(DISTINCT "field"."label") FILTER (WHERE "field"."required") AS "labels", min("field"."position") FILTER (WHERE "field"."required") AS "first", max("field"."position") FILTER (WHERE "field"."required") AS "last", sum("field"."position") FILTER (WHERE "field"."required") AS "positions", avg("field"."position") FILTER (WHERE "field"."required") AS "average", bool_and("field"."required") FILTER (WHERE "field"."position" > $2) AS "allRequired", bool_or("field"."required") FILTER (WHERE "field"."position" > $3) AS "anyRequired" FROM "field" AS "field"',
      parameters: ["1", "2", "3"],
    })
    expect(nested.toSQL().text).toBe(
      'SELECT count(*) FILTER (WHERE EXISTS (SELECT FROM "field" AS "field" WHERE "field"."formId" = "form"."id")) AS "withFields" FROM "form" AS "form"',
    )
  })

  it("joins the values of stringAgg with its delimiter in the order of its option, also of a query, with its parameters in the order of the text", () => {
    const query = from(field).select(field => ({
      joined: stringAgg(field.label, ", "),
      ordered: stringAgg(field.label, "; ", {
        orderBy: [desc(field.position), field.id],
        filter: field.position.gt(1),
      }),
    }))
    const nested = schema.form.select(form => ({
      names: stringAgg(form.name, ", ", { orderBy: form.fields.count() }),
    }))

    expect(query.toSQL()).toEqual({
      text: 'SELECT string_agg("field"."label", $1) AS "joined", string_agg("field"."label", $2 ORDER BY "field"."position" DESC, "field"."id") FILTER (WHERE "field"."position" > $3) AS "ordered" FROM "field" AS "field"',
      parameters: [", ", "; ", "1"],
    })
    expect(nested.toSQL().text).toBe(
      'SELECT string_agg("form"."name", $1 ORDER BY (SELECT count(*) AS "count" FROM "field" AS "field" WHERE "field"."formId" = "form"."id")) AS "names" FROM "form" AS "form"',
    )
  })

  it("is an operand of a function, of an operator, and of caseWhen, and a sort key by its selected field", () => {
    const query = from(field)
      .select(field => ({
        positions: coalesce(sum(field.position), 0),
        several: count().gt(1),
        size: caseWhen(t.text, [[count().gt(10), "large"]], "small"),
      }))
      .orderBy((_field, selected) => desc(selected.positions))

    expect(query.toSQL()).toEqual({
      text: 'SELECT coalesce(sum("field"."position"), $1) AS "positions", count(*) > $2 AS "several", CASE WHEN (count(*) > $3) THEN ($4::text) ELSE ($5::text) END AS "size" FROM "field" AS "field" ORDER BY 1 DESC',
      parameters: ["0", "1", "10", "large", "small"],
    })
  })

  it("applies a limit to the row of the result, unlike an aggregate method, which aggregates the rows of the page", () => {
    const limited = from(field).limit(10)

    expect(limited.select(() => ({ total: count() })).toSQL().text).toBe(
      'SELECT count(*) AS "total" FROM "field" AS "field" LIMIT $1',
    )
    expect(limited.count().toSQL().text).toBe(
      'SELECT count(*) AS "count" FROM (SELECT FROM "field" AS "field" LIMIT $1) AS "subquery"',
    )
  })

  it("rejects a value other than an expression with a type or a query of one value, also undefined of count", () => {
    const message = "The argument of sum must be a query of one value of a table or an expression"

    expect(() => sum(1 as never)).toThrow(message)
    expect(() => sum(null as never)).toThrow(message)
    expect(() => sum(sql<number>`1` as never)).toThrow(message)
    expect(() => sum(t.integer as never)).toThrow(message)
    expect(() => count(undefined as never)).toThrow("The argument of count")
    expect(() => countDistinct(undefined as never)).toThrow("The argument of countDistinct")
  })

  it("rejects a query other than of one value", () => {
    const message = "An expression takes a query of one value"

    expect(() => sum(from(field).pluck("position") as never)).toThrow(message)
    expect(() => sum(from(field).select("position").take() as never)).toThrow(message)
  })

  it("rejects options other than an object of its options, a filter other than an expression or a query, and a delimiter other than a string", () => {
    const columns = createColumnRefs<typeof field>(from(field).node.from)

    // An object of column values or another object passed instead of an argument must not count every row.
    expect(() => count({ required: true } as never)).toThrow('count has no option "required"')
    for (const value of [new Date(), /required/, Object(4)]) {
      expect(() => count(value as never)).toThrow("The argument of count")
    }
    expect(() => sum(columns.position, { orderBy: columns.id } as never)).toThrow(
      'sum has no option "orderBy"',
    )
    for (const value of [true, new Date()]) {
      expect(() => sum(columns.position, value as never)).toThrow(
        "The options of sum must be a plain object",
      )
    }
    expect(() => count({ filter: { required: true } } as never)).toThrow(
      "The filter of count must be an expression or a query of one Boolean value",
    )
    expect(() => stringAgg(columns.label, { orderBy: columns.id } as never)).toThrow(
      "The delimiter of stringAgg must be a string",
    )
    expect(() => stringAgg(columns.label, ", ", { orderBy: "position" } as never)).toThrow(
      "The option orderBy of stringAgg takes expressions, queries of one value, or sort keys of asc, desc, and orderBy",
    )
  })

  it("runs a query of a Db only in a statement of the same Db", () => {
    const database = createDatabase({ driver: createRecordingDriver().driver })
    const db = bindSchema(schema, database)
    const otherDb = bindSchema(schema, database)

    expect(() =>
      db.$compile(
        db.form.select(() => ({
          most: max(otherDb.field.count()),
        })),
      ),
    ).toThrow("bound to another Db")
  })
})

describe("the type of an aggregate function", () => {
  const score = sql(scoreType)`1`

  it("decodes a count as a count, and another aggregate by the type of its argument", () => {
    expect(getType(count())).toBe(countType)
    expect(getType(count(score))).toBe(countType)
    expect(getType(countDistinct(score))).toBe(countType)
    expect(getType(min(score))).toBe(scoreType)
    expect(getType(max(score))).toBe(scoreType)
    expect(getType(avg(score))).toBe(scoreType)
    expect(getType(every(score))).toBe(scoreType)
    expect(getType(some(score))).toBe(scoreType)
  })

  it("decodes the sum of integer values as a bigint that rejects what a number cannot hold exactly", () => {
    const type = getType(sum(sql(t.integer)`1`))!

    expect(type.castType).toBe("bigint")
    expect(type.decode("12")).toBe(12)
    expect(() => type.decode(String(BigInt(Number.MAX_SAFE_INTEGER) + 1n))).toThrow(
      "outside the safe integer range of numbers",
    )
  })

  it("has the operators of its type", () => {
    expect(toNode(sum(sql(t.integer)`1`).gt(1)).kind).toBe("comparison")
    expect(toNode(max(sql(t.text)`1`).like("a%")).kind).toBe("comparison")
    expect(toNode(count().gt(1)).kind).toBe("comparison")
  })

  it("rejects the average of a type of bigint values when it is called", () => {
    expect(() => avg(sql(t.bigint)`1`)).toThrow(
      "avg of bigint values requires a type that can represent fractional values",
    )
  })
})

describePostgres("in PostgreSQL", ({ database, testTransaction, useTestFixture }) => {
  const form1Id = "00000000-0000-0000-0000-000000000001"
  const form2Id = "00000000-0000-0000-0000-000000000002"

  useTestFixture(() =>
    database.script(`
      CREATE TABLE form (
        id uuid PRIMARY KEY,
        name text NOT NULL
      );
      CREATE TABLE field (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "formId" uuid NOT NULL,
        position integer NOT NULL,
        label text,
        required boolean NOT NULL,
        size bigint NOT NULL,
        score integer NOT NULL
      );
      INSERT INTO form (id, name) VALUES
        ('${form1Id}', 'form 1'),
        ('${form2Id}', 'form 2');
      INSERT INTO field ("formId", position, label, required, size, score) VALUES
        ('${form1Id}', 1, 'a', TRUE, 10, 3),
        ('${form1Id}', 2, 'a', FALSE, 20, 8),
        ('${form1Id}', 4, NULL, FALSE, 9007199254740991, 2);
    `),
  )

  const db = bindSchema(schema, database)
  const fields = db.field.where({ formId: form1Id })
  const noFields = db.field.where({ formId: form2Id })

  it("gives the aggregates of the rows in one record, decoded by their types", async () => {
    const query = (rows: typeof fields) =>
      rows
        .select(field => ({
          total: count(),
          labelled: count(field.label),
          labels: countDistinct(field.label),
          first: min(field.position),
          last: max(field.position),
          positions: sum(field.position),
          average: avg(field.position),
          allRequired: every(field.required),
          anyRequired: some(field.required),
          bestScore: max(field.score),
        }))
        .take()

    const results = await testTransaction(async () => [await query(fields), await query(noFields)])

    expect(results).toEqual([
      {
        total: 3,
        labelled: 2,
        labels: 1,
        first: 1,
        last: 4,
        positions: 7,
        average: expect.closeTo(7 / 3, 10),
        allRequired: false,
        anyRequired: true,
        bestScore: { value: 8 },
      },
      {
        total: 0,
        labelled: 0,
        labels: 0,
        first: null,
        last: null,
        positions: null,
        average: null,
        allRequired: null,
        anyRequired: null,
        bestScore: null,
      },
    ])
  })

  it("aggregates the rows of a condition beside each other, giving 0 of a count and null of another aggregate without such rows", async () => {
    const result = await testTransaction(
      async () =>
        await fields
          .select(field => ({
            required: count({ filter: field.required }),
            optional: count({ filter: not(field.required) }),
            optionalPositions: sum(field.position, { filter: not(field.required) }),
            none: count({ filter: field.position.gt(10) }),
            noPositions: sum(field.position, { filter: field.position.gt(10) }),
          }))
          .take(),
    )

    expect(result).toEqual({
      required: 1,
      optional: 2,
      optionalPositions: 6,
      none: 0,
      noPositions: null,
    })
  })

  describe("query of groups", () => {
    const groups = db.field.groupBy("required")

    it("aggregates the rows of a condition of each group, and joins its values in the order of stringAgg", async () => {
      const rows = await testTransaction(
        async () =>
          await groups.orderBy("required").select(field => ({
            required: field.required,
            labelled: count({ filter: not(field.label.isNull()) }),
            positions: stringAgg(sql(t.text)`${field.position}::text`, ",", {
              orderBy: desc(field.position),
            }),
            labelledPositions: stringAgg(sql(t.text)`${field.position}::text`, ",", {
              orderBy: field.position,
              filter: not(field.label.isNull()),
            }),
          })),
      )

      expect(rows).toEqual([
        { required: false, labelled: 1, positions: "4,2", labelledPositions: "2" },
        { required: true, labelled: 1, positions: "1", labelledPositions: "1" },
      ])
    })

    it("filters and sorts the groups by an aggregate of a condition, and aggregates it over the groups", async () => {
      const results = await testTransaction(async () => ({
        having: await groups
          .having(field => count({ filter: field.label.isNull() }).eq(1))
          .pluck("required"),
        sorted: await groups
          .orderBy(field => desc(count({ filter: field.required })))
          .pluck("required"),
        largest: await groups.max(field => count({ filter: field.position.gt(2) })),
      }))

      // Without the filters, the groups of 1 and 2 rows would give [true], [false, true], and 2.
      expect(results).toEqual({ having: [false], sorted: [true, false], largest: 1 })
    })
  })

  it("gives one row in an array without take", async () => {
    const rows = await testTransaction(
      async () =>
        await fields.select(() => ({
          total: count(),
        })),
    )

    expect(rows).toEqual([{ total: 3 }])
  })

  it("counts every row with a limit, which applies to the row of the result, unlike an aggregate method", async () => {
    const results = await testTransaction(async () => ({
      selected: await fields.limit(1).select(() => ({
        total: count(),
      })),
      method: await fields.limit(1).count(),
    }))

    expect(results).toEqual({ selected: [{ total: 3 }], method: 1 })
  })

  it("replaces NULL with coalesce, and reads a condition of aggregates", async () => {
    const result = await testTransaction(
      async () =>
        await noFields
          .select(field => ({
            positions: coalesce(sum(field.position), 0),
            none: count().eq(0),
            size: caseWhen(t.text, [[count().gt(0), "some"]], "none"),
          }))
          .take(),
    )

    expect(result).toEqual({ positions: 0, none: true, size: "none" })
  })

  it("aggregates the rows of a nested query, also in a page of its parent after an offset", async () => {
    const select = (query: typeof db.form) =>
      query
        .orderBy("name")
        .select("name")
        .select(form => ({
          stats: form.fields
            .select(field => ({
              total: count(),
              last: max(field.position),
            }))
            .take(),
        }))

    const results = await testTransaction(async () => [
      await select(db.form),
      await select(db.form).offset(1),
    ])

    expect(results).toEqual([
      [
        { name: "form 1", stats: { total: 3, last: 4 } },
        { name: "form 2", stats: { total: 0, last: null } },
      ],
      [{ name: "form 2", stats: { total: 0, last: null } }],
    ])
  })

  it("rejects a sum outside the safe integer range of numbers with the path of its field", async () => {
    const query = fields
      .select(field => ({
        sizes: sum(sql(t.integer)`${field.size}`),
      }))
      .take()

    const error: unknown = await testTransaction(async () => await query).catch(
      (caught: unknown) => caught,
    )

    expect(error).toBeInstanceOf(ResultDecodeError)
    expect(error).toMatchObject({ path: "sizes" })
  })

  describe("what PostgreSQL rejects", () => {
    it("rejects an aggregate in a filter", async () => {
      await expect(
        testTransaction(async () => await db.field.where(() => count().gt(0)).pluck("id")),
      ).rejects.toThrow("aggregate functions are not allowed in WHERE")
    })

    it("rejects an aggregate in the values of an update", async () => {
      await expect(
        testTransaction(
          async () =>
            await fields.update(field => ({
              position: coalesce(max(field.position), 0),
            })),
        ),
      ).rejects.toThrow("aggregate functions are not allowed in UPDATE")
    })

    it("rejects an aggregate beside a row lock", async () => {
      await expect(
        testTransaction(() =>
          db.$transaction(
            async () =>
              await fields
                .select(() => ({
                  total: count(),
                }))
                .forUpdate(),
          ),
        ),
      ).rejects.toThrow("FOR UPDATE is not allowed with aggregate functions")
    })

    it("rejects a column beside an aggregate", async () => {
      await expect(
        testTransaction(
          async () =>
            await fields.select("label").select(() => ({
              total: count(),
            })),
        ),
      ).rejects.toThrow("must appear in the GROUP BY clause")
    })
  })
})
