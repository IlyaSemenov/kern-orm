import { describe, expect, it } from "bun:test"

import { describePostgres } from "../../testing/postgres"
import { createRecordingDriver } from "../../testing/recording-driver"
import { createDatabase } from "../execution/database"
import { desc } from "../query/order"
import { from } from "../query/select"
import { NotFoundError, ResultDecodeError } from "../result/result"
import { many, one } from "../schema/relation"
import { defineSchema } from "../schema/schema"
import { defineTable } from "../table/table"
import * as t from "../types"

import { getType, toNode } from "./expression"
import { coalesce, greatest, least } from "./functions"
import { and } from "./predicates"
import { sql } from "./sql"

const scoreType = t.integer.transform({
  decode: value => ({ value }),
  encode: (score: { value: number }) => score.value,
})

const form = defineTable("form", {
  id: t.uuid.primaryKey(),
  name: t.text,
  hint: t.text.nullable(),
  limit: t.integer.nullable(),
  bonus: t.integer.nullable(),
  price: t.numeric.nullable(),
  score: scoreType.nullable(),
})

const field = defineTable("field", {
  id: t.uuid.primaryKey(),
  formId: t.uuid,
  position: t.integer,
  label: t.text,
})

const schema = defineSchema({ form, field }).$relations({
  form: { fields: many(field, { from: "id", to: "formId" }) },
  field: { form: one(form, { from: "formId", to: "id", required: true }) },
})

describe("the SQL of a function", () => {
  it("calls the function of its operands, with a plain value as a parameter", () => {
    const query = from(form).select(form => ({
      fallback: coalesce(form.limit, 0),
      largest: greatest(form.limit, form.bonus, 1),
      smallest: least(form.limit, form.bonus),
    }))

    expect(query.toSQL()).toEqual({
      text: 'SELECT coalesce("form"."limit", $1) AS "fallback", greatest("form"."limit", "form"."bonus", $2) AS "largest", least("form"."limit", "form"."bonus") AS "smallest" FROM "form" AS "form"',
      parameters: ["0", "1"],
    })
  })

  it("encodes a plain value with the type of the first operand", () => {
    const query = from(form).select(form => ({
      price: coalesce(form.price, 1.5),
      score: coalesce(form.score, { value: 7 }),
    }))

    expect(query.toSQL().parameters).toEqual(["1.5", "7"])
  })

  it("adds no cast to a plain value, which PostgreSQL types by the first operand", () => {
    const query = schema.form.select(form => ({
      value: coalesce(form.fields.count(), 0),
    }))

    expect(query.toSQL().text).toEndWith(', $1) AS "value" FROM "form" AS "form"')
  })

  it("takes a query as an operand, with its parameters in the order of the text", () => {
    const query = schema.form.select(form => ({
      value: coalesce(
        form.fields.where({ label: "label 1" }).max("position"),
        form.fields.where({ label: "label 2" }).max("position"),
        3,
      ),
    }))

    const { text, parameters } = query.toSQL()
    expect(text.match(/\(SELECT max/g)).toHaveLength(2)
    expect(parameters).toEqual(["label 1", "label 2", "3"])
  })

  it("parenthesizes the call as an operand of an operator", () => {
    const query = from(form)
      .where(form => coalesce(form.limit, 0).gt(3))
      .select("id")

    expect(query.toSQL().text).toEndWith('WHERE (coalesce("form"."limit", $1)) > $2')
  })
})

describe("the type of a function", () => {
  it("is the type of the first operand, which gives its operators", () => {
    const value = coalesce(sql(t.text)`'a'`, "b")

    expect(getType(value)).toBe(t.text)
    expect(toNode(value.like("a%")).kind).toBe("comparison")
  })

  it("is the type of the value of a query", () => {
    expect(getType(coalesce(from(field).max("position"), 0))).toBe(t.integer)
    expect(getType(coalesce(from(field).take().get("label"), ""))).toBe(t.text)
  })
})

describe("rejected operands", () => {
  it("rejects a first operand without a type", () => {
    const message = /The first operand of coalesce must be a query of one value/

    expect(() => coalesce(0 as never, 1 as never)).toThrow(message)
    expect(() => coalesce(null as never, 1 as never)).toThrow(message)
    expect(() => coalesce(sql<number>`1` as never, 1 as never)).toThrow(message)
    expect(() => coalesce(t.integer as never, 1 as never)).toThrow(message)
    expect(() => coalesce(schema.$select({ a: from(form).count() }) as never, 1 as never)).toThrow(
      message,
    )
  })

  it("names the function in the error of a first operand", () => {
    expect(() => greatest(0 as never, 1 as never)).toThrow("The first operand of greatest")
    expect(() => least(0 as never, 1 as never)).toThrow("The first operand of least")
  })

  it("rejects a query of the first operand that an expression rejects", () => {
    const message = "An expression takes a query of one value"

    expect(() => coalesce(from(form).pluck("limit") as never, 1 as never)).toThrow(message)
    expect(() => coalesce(from(form).select("limit").take() as never, 1 as never)).toThrow(message)
  })

  it("rejects a plain null and undefined among the following operands", () => {
    const column = from(field).max("position")

    expect(() => coalesce(column, null as never)).toThrow("coalesce takes a value other than null")
    expect(() => greatest(column, undefined as never)).toThrow(
      "greatest takes a value other than undefined",
    )
    expect(() => least(column, null as never)).toThrow("least takes a value other than null")
  })

  it("rejects a following query that an expression rejects", () => {
    const column = from(field).max("position")

    expect(() => coalesce(column, from(field).pluck("position") as never)).toThrow(
      "An expression takes a query of one value",
    )
  })
})

describe("a query of a Db among the operands", () => {
  it("runs only in a statement of the same Db", () => {
    const database = createDatabase({ driver: createRecordingDriver().driver })
    const db = database.bind(schema)
    const otherDb = database.bind(schema)
    const query = db.form.select(() => ({
      value: coalesce(otherDb.field.max("position"), 0),
    }))

    expect(() => db.$compile(query)).toThrow("bound to another Db")
    expect(() =>
      db.$compile(
        db.form.select(() => ({
          value: coalesce(db.field.max("position"), 0),
        })),
      ),
    ).not.toThrow()
  })
})

describePostgres("in PostgreSQL", ({ database, testTransaction, useTestFixture }) => {
  const form1Id = "00000000-0000-0000-0000-000000000001"
  const form2Id = "00000000-0000-0000-0000-000000000002"
  const form3Id = "00000000-0000-0000-0000-000000000003"

  useTestFixture(() =>
    database.script(`
      CREATE TABLE form (
        id uuid PRIMARY KEY,
        name text NOT NULL,
        hint text,
        "limit" integer,
        bonus integer,
        price numeric,
        score integer
      );
      CREATE TABLE field (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "formId" uuid NOT NULL,
        position integer NOT NULL,
        label text NOT NULL
      );
      INSERT INTO form (id, name, hint, "limit", bonus, price, score) VALUES
        ('${form1Id}', 'form 1', 'Hint', 5, 9, 1.50, 3),
        ('${form2Id}', 'form 2', NULL, NULL, 2, NULL, NULL),
        ('${form3Id}', 'form 3', NULL, NULL, NULL, NULL, NULL);
      INSERT INTO field ("formId", position, label) VALUES
        ('${form1Id}', 1, 'a'),
        ('${form1Id}', 12, 'b');
    `),
  )

  const db = database.bind(schema)
  const byName = db.form.orderBy("name")

  it("replaces NULL with the first value other than NULL", async () => {
    const query = byName.select(form => ({
      hint: coalesce(form.hint, "none"),
      limit: coalesce(form.limit, form.bonus, 0),
    }))

    expect(await testTransaction(async () => await query)).toEqual([
      { hint: "Hint", limit: 5 },
      { hint: "none", limit: 2 },
      { hint: "none", limit: 0 },
    ])
  })

  it("skips NULL in greatest and least, which are NULL only when every operand is", async () => {
    const query = byName.select(form => ({
      largest: greatest(form.limit, form.bonus),
      smallest: least(form.limit, form.bonus),
    }))

    expect(await testTransaction(async () => await query)).toEqual([
      { largest: 9, smallest: 5 },
      { largest: 2, smallest: 2 },
      { largest: null, smallest: null },
    ])
  })

  it("decodes the result with the type of the first operand", async () => {
    const query = byName.select(form => ({
      score: coalesce(form.score, { value: 0 }),
      price: coalesce(form.price, 0),
    }))

    expect(await testTransaction(async () => await query)).toEqual([
      { score: { value: 3 }, price: "1.50" },
      { score: { value: 0 }, price: "0" },
      { score: { value: 0 }, price: "0" },
    ])
  })

  // A count is a `bigint` of PostgreSQL, which a check of the same SQL type would reject beside an `integer`.
  it("takes operands of different SQL types whose common type its type decodes", async () => {
    const query = byName.select(form => ({
      countFirst: greatest(form.fields.count(), form.bonus),
      countLater: greatest(form.bonus, form.fields.count()),
    }))

    expect(await testTransaction(async () => await query)).toEqual([
      { countFirst: 9, countLater: 9 },
      { countFirst: 2, countLater: 2 },
      { countFirst: 0, countLater: 0 },
    ])
  })

  it("rejects when the common type of its operands has another representation", async () => {
    const query = db.$select({
      value: greatest(
        sql(t.timestamp)`'2026-01-01 10:00'::timestamp`,
        sql(t.timestamptz)`'2026-01-01 10:00+00'::timestamptz`,
      ),
    })

    await expect(testTransaction(async () => await query)).rejects.toThrow(ResultDecodeError)
  })

  it("rejects operands without a common type", async () => {
    const query = db.$select({
      value: coalesce(sql(t.text)`'a'::text`, sql(t.text)`gen_random_uuid()`),
    })

    await expect(testTransaction(async () => await query)).rejects.toThrow("cannot be matched")
  })

  it("is the fallback for a query without its row, while the method of the query keeps the row missing", async () => {
    const missing = db.form.where({ name: "missing" }).take().get("hint")
    const query = db.$select({
      value: coalesce(missing, "fallback"),
    })

    expect(await testTransaction(async () => await query)).toEqual({ value: "fallback" })
    await expect(testTransaction(async () => await missing.coalesce("fallback"))).rejects.toThrow(
      NotFoundError,
    )
  })

  it("is an operand of an operator, a condition, a sort key, and an argument of an aggregate", async () => {
    const compared = db.form.where(form => coalesce(form.limit, 0).gte(5)).pluck("name")
    const condition = db.form.where(form => coalesce(form.limit.gt(3), false)).pluck("name")
    const sorted = db.form
      .orderBy(form => [desc(coalesce(form.bonus, 0)), desc(form.name)])
      .pluck("name")
    const aggregated = db.form.sum(form => coalesce(form.bonus, 100))

    expect(await testTransaction(async () => await compared)).toEqual(["form 1"])
    expect(await testTransaction(async () => await condition)).toEqual(["form 1"])
    expect(await testTransaction(async () => await sorted)).toEqual(["form 1", "form 2", "form 3"])
    expect(await testTransaction(async () => await aggregated)).toBe(111)
  })

  it("is a condition inside and", async () => {
    const query = db.form
      .where(form => and(coalesce(form.limit, 0).gte(5), coalesce(form.bonus, 0).gte(9)))
      .pluck("name")

    expect(await testTransaction(async () => await query)).toEqual(["form 1"])
  })

  it("is the value of a column of an update", async () => {
    const query = db.form
      .where({ name: "form 2" })
      .update(form => ({
        limit: coalesce(form.limit, form.bonus, 0),
      }))
      .pluck("limit")

    expect(await testTransaction(async () => await query)).toEqual([2])
  })

  it("nests in another function over queries of relations of each row", async () => {
    const query = byName.select(form => ({
      weight: greatest(coalesce(form.fields.max("position"), 0), coalesce(form.bonus, 0)),
    }))

    expect(await testTransaction(async () => await query)).toEqual([
      { weight: 12 },
      { weight: 2 },
      { weight: 0 },
    ])
  })

  // A function is a SQL fragment, so lowering keeps a page of a query whose nested queries hold one that refers to its table on the table.
  it("reads the columns of the parent row in nested queries of a page after an offset", async () => {
    const query = db.form
      .orderBy(form => desc(form.name))
      .limit(1)
      .offset(2)
      .select(form => ({
        name: form.name,
        positions: form.fields
          .orderBy("position")
          .pluck(field => least(field.position, form.limit)),
        value: coalesce(form.fields.max("position"), form.bonus),
      }))

    expect(await testTransaction(async () => await query)).toEqual([
      { name: "form 1", positions: [1, 5], value: 12 },
    ])
  })
})
