import { describe, expect, it } from "bun:test"
import { runInNewContext } from "node:vm"

import { createRecordingDriver } from "@kern-orm/test-harness/recording-driver"
import { createDatabase, NotFoundError, ResultDecodeError } from "kern-db"

import { describePostgres } from "../../testing/postgres"
import { bindSchema } from "../execution/db"
import { coalesce } from "../expression/functions"
import { not } from "../expression/predicates"
import { sql } from "../expression/sql"
import { RequiredRelationError } from "../result/result"
import { many, one } from "../schema/relation"
import { defineSchema } from "../schema/schema"
import { defineTable } from "../table/table"
import * as t from "../types"

import { defineHelper } from "./helper"
import { from } from "./select"

const form = defineTable("form", {
  id: t.integer.primaryKey(),
  name: t.text,
})

const field = defineTable("field", {
  id: t.integer.primaryKey(),
  formId: t.integer.columnName("form_id"),
  label: t.text,
  hint: t.text.nullable(),
})

const schema = defineSchema({ form, field }).$relations({
  form: {
    fields: many(field, { from: "id", to: "formId" }),
  },
  field: {
    form: one(form, { from: "formId", to: "id", required: true }),
  },
})

const toUpper = (name: string) => name.toUpperCase()
const failOnCall = (): never => {
  throw new Error("Unexpected call")
}

/** Creates a `Db` whose driver answers every statement with `rows`, with the statements that it runs. */
function connect(rows: readonly (readonly (string | null)[])[] = [], count = rows.length) {
  const { driver, statements } = createRecordingDriver({ respond: () => ({ rows, count }) })
  return { db: bindSchema(schema, createDatabase({ driver })), statements }
}

/** Returns the error that `query` rejects with. */
function captureFailure(query: PromiseLike<unknown>) {
  return query.then(
    () => undefined,
    (reason: unknown) => reason as ResultDecodeError,
  )
}

describe("map of a query", () => {
  it("keeps the SQL of the query, and leaves the query it is called on unchanged", () => {
    const names = from(form).where({ id: 1 }).pluck("name")

    expect(names.map(toUpper).toSQL()).toEqual(names.toSQL())
    expect(names.node.conversion).toBeUndefined()
  })

  it("keeps a bound query bound to its Db, and an unbound query not thenable", () => {
    const { db } = connect()
    const bound = db.form.pluck("name").map(toUpper)
    const unbound = schema.form.pluck("name").map(toUpper)

    expect(bound.db).toBe(db)
    expect(typeof bound.then).toBe("function")
    expect(unbound.db).toBeUndefined()
    expect(unbound.then).toBeUndefined()
  })

  it("takes the methods that keep the fields, with the SQL that they give before map", () => {
    const fields = from(form).select("id", "name")
    const toId = (row: { id: number }) => row.id

    for (const [after, before] of [
      [fields.map(toId).where({ name: "a" }), fields.where({ name: "a" })],
      [fields.map(toId).find(1), fields.find(1)],
      [fields.map(toId).findBy({ id: 1 }), fields.findBy({ id: 1 })],
      [fields.map(toId).orderBy("name"), fields.orderBy("name")],
      [fields.map(toId).orderBy({ name: "desc" }), fields.orderBy({ name: "desc" })],
      [fields.map(toId).orderBy(columns => columns.name), fields.orderBy(columns => columns.name)],
      [fields.map(toId).limit(2).offset(1), fields.limit(2).offset(1)],
      [fields.map(toId).distinct(), fields.distinct()],
      [fields.map(toId).take(), fields.take()],
      [fields.map(toId).take().optional(), fields.take().optional()],
      [fields.map(toId).take().nullable(), fields.take().nullable()],
      [fields.map(toId).take().required(), fields.take().required()],
      [fields.map(toId).all(), fields.all()],
    ] as const) {
      expect(after.toSQL()).toEqual(before.toSQL())
      expect(after.node.conversion).toBeDefined()
    }
  })

  it("rejects the methods that read or change the fields", () => {
    const records = from(form).select("id").map(String)
    const message = "cannot be used after map; call it before map"

    for (const method of [
      () => (records as unknown as { select(key: string): unknown }).select("name"),
      () => (records as unknown as { clearSelect(): unknown }).clearSelect(),
      () => (records as unknown as { get(key: string): unknown }).get("name"),
      () => (records as unknown as { pluck(key: string): unknown }).pluck("name"),
      () => (records as unknown as { count(): unknown }).count(),
      () => (records as unknown as { max(key: string): unknown }).max("id"),
      () => (records as unknown as { exists(): unknown }).exists(),
      () => (records as unknown as { coalesce(value: unknown): unknown }).coalesce(0),
    ]) {
      expect(method).toThrow(message)
    }
  })

  it("rejects a mutation of a query that it converts, whose returned fields come after the mutation", () => {
    const query = schema.form.map(String)

    expect(() => query.insert({ id: 1, name: "a" })).toThrow("applies only to a query of a table")
    expect(() => query.where({ id: 1 }).update({ name: "a" })).toThrow("call map after update")
    expect(() => query.where({ id: 1 }).delete()).toThrow("call map after delete")
  })

  it("rejects the query as an operand of an expression, whose SQL would read the value without its conversion", () => {
    const value = from(form).find(1).get("name").map(toUpper)
    const message = "not a query of map"

    expect(() =>
      // @ts-expect-error A query of `map` is not an operand.
      not(value),
    ).toThrow(message)
    expect(() =>
      // @ts-expect-error A query of `map` is not an operand.
      coalesce(from(form).get("name"), value),
    ).toThrow(message)
    expect(() =>
      // @ts-expect-error A query of `map` has no type of its value for the first operand.
      coalesce(value, "none"),
    ).toThrow(message)
    expect(() =>
      // @ts-expect-error A query of `map` has no expression.
      value.expr(),
    ).toThrow(message)
    expect(() => sql`${value}`).toThrow("a query of map or transform")
    expect(() =>
      // @ts-expect-error The callback of `get` takes no query of `map`.
      from(form).get(() => value),
    ).toThrow(message)
    expect(() =>
      from(form).where(columns =>
        // @ts-expect-error A query of `map` is not an operand.
        columns.name.eq(value),
      ),
    ).toThrow(message)
    expect(() =>
      from(form).where(columns =>
        // @ts-expect-error A query of `map` is not a query of values.
        columns.name.in(from(form).pluck("name").map(toUpper)),
      ),
    ).toThrow("in takes a query of values, such as of pluck, not a query of map")
    expect(() =>
      from(form).find(1).update({
        // @ts-expect-error A query of `map` is not the value of a column.
        name: value,
      }),
    ).toThrow(message)
    expect(() =>
      from(form).orderBy(
        // @ts-expect-error A sort key takes no query of `map`.
        () => value,
      ),
    ).toThrow(message)
  })

  it("takes the query in a selection as a field of nested rows, also of an aggregate, which sorting rejects", () => {
    const query = from(form).select(columns => ({
      count: from(field).count().map(String),
      name: columns.name,
    }))

    expect(() => query.orderBy((_, selected) => selected.count)).toThrow(
      'Field "count" holds nested rows and cannot be sorted by',
    )
    expect(query.orderBy((_, selected) => selected.name).toSQL().text).toContain("ORDER BY 2")
  })

  it("rejects a value that is not a function", () => {
    // @ts-expect-error `map` takes a callback.
    expect(() => from(form).map("name")).toThrow("map takes a callback")
  })

  it("applies through use, whose callback returns the query", async () => {
    const { db } = connect([["a"]])

    expect(await db.form.pluck("name").use(query => query.map(toUpper))).toEqual(["A"])
  })
})

describe("transform of a query", () => {
  it("keeps the SQL of the query, also after map, with the options of toSQL", () => {
    const names = from(form).where({ id: 1 }).pluck("name")

    expect(names.transform(values => values.length).toSQL()).toEqual(names.toSQL())
    expect(
      names
        .map(toUpper)
        .transform(values => values.length)
        .toSQL({ schemaName: "tenant" }),
    ).toEqual(names.toSQL({ schemaName: "tenant" }))
  })

  it("keeps a bound query bound to its Db, compiles as its Db does, and rejects options", () => {
    const { driver } = createRecordingDriver({ respond: () => ({ rows: [] }) })
    const db = bindSchema(schema, createDatabase({ driver }), { schemaName: "tenant" })
    const query = db.form.pluck("name")
    const transformed = query.transform(String)

    expect(transformed.db).toBe(db)
    expect(transformed.toSQL()).toEqual(query.toSQL())
    expect(() => (transformed.toSQL as (options: object) => unknown)({})).toThrow(
      "A query bound to a Db compiles with the options of its Db",
    )
    expect(schema.form.count().transform(String).then).toBeUndefined()
  })

  it("rejects being an operand of an expression", () => {
    const value = from(form).find(1).get("name").transform(toUpper)
    const message = "a query of transform"

    expect(() =>
      // @ts-expect-error A query of `transform` is not an operand.
      not(value),
    ).toThrow(message)
    expect(() => sql`${value}`).toThrow("a query of map or transform")
    expect(() =>
      from(form).find(1).update({
        // @ts-expect-error A query of `transform` is not the value of a column.
        name: value,
      }),
    ).toThrow(message)
  })

  it("rejects being returned from the callback of use and a helper, which keep the query", () => {
    const names = from(form).pluck("name")
    const convert = (query: { transform(callback: unknown): unknown }) => query.transform(String)

    expect(() => names.use(convert as never)).toThrow("must return the query it receives")
    expect(() => defineHelper(form, convert as never)(from(form) as never)).toThrow(
      "must return the query it receives",
    )
  })

  it("rejects a value that is not a function", () => {
    const names = from(form).pluck("name")

    // @ts-expect-error `transform` takes a callback.
    expect(() => names.transform("name")).toThrow("transform takes a callback")
    // @ts-expect-error `transform` takes a callback.
    expect(() => names.transform(String).transform(undefined)).toThrow("transform takes a callback")
  })
})

describe("decoding by a recording driver", () => {
  it("applies the conversions in their order", async () => {
    const { db } = connect([["a"], ["b"]])

    expect(
      await db.form
        .pluck("name")
        .map(toUpper)
        .map(name => `${name}!`)
        .transform(names => names.join())
        .transform(joined => `[${joined}]`),
    ).toBe("[A!,B!]")
  })

  it("executes with $execute of a Db", async () => {
    const { db } = connect([["a"]])

    expect(await db.$execute(schema.form.pluck("name").map(toUpper))).toEqual(["A"])
    expect(await db.$execute(schema.form.pluck("name").transform(names => names.length))).toBe(1)
  })

  it("rejects with ResultDecodeError when a callback returns a Promise or a query, which decoding cannot wait for", async () => {
    const { db } = connect([["a"]])

    for (const error of [
      await captureFailure(
        db.form.pluck("name").map(
          // @ts-expect-error A callback returns its result synchronously.
          async name => name,
        ),
      ),
      await captureFailure(
        db.form.pluck("name").transform(
          // @ts-expect-error A callback returns its result synchronously.
          async names => names,
        ),
      ),
      // A callback can return a Promise through `any`.
      await captureFailure(db.form.pluck("name").map((): any => Promise.resolve(1))),
      await captureFailure(
        db.form.pluck("name").transform(
          // @ts-expect-error A callback returns its result synchronously, and a bound query executes when awaited.
          () => db.form.count(),
        ),
      ),
    ]) {
      expect(error).toBeInstanceOf(ResultDecodeError)
      expect(error?.cause).toMatchObject({
        message: expect.stringContaining("must return its result synchronously"),
      })
    }
    // The earlier conversion of a chain fails by itself.
    const chained = await captureFailure(
      db.form
        .pluck("name")
        .map((): any => Promise.resolve(1))
        .map(failOnCall),
    )
    expect(chained?.cause).toMatchObject({
      message: expect.stringContaining("The callback of map"),
    })
  })

  it("handles the rejection of a Promise that a callback returned, also a later one or of another realm, so that it stays out of unhandled rejections", async () => {
    const { db } = connect([["a"]])
    const unhandled: unknown[] = []
    const onUnhandled = (reason: unknown) => unhandled.push(reason)
    process.on("unhandledRejection", onUnhandled)
    try {
      const rejected = await captureFailure(
        db.form.pluck("name").transform((): unknown => Promise.reject(new Error("Rejected"))),
      )
      const later = await captureFailure(
        db.form.pluck("name").map(
          (): unknown =>
            new Promise((_, reject) => {
              setTimeout(() => reject(new Error("Rejected later")))
            }),
        ),
      )
      const ofAnotherRealm = await captureFailure(
        db.form
          .pluck("name")
          .transform((): unknown => runInNewContext("Promise.reject(new Error('Rejected'))")),
      )
      // Longer than the timer of the Promise, and than the turn in which a runtime reports an unhandled rejection.
      await new Promise(resolve => setTimeout(resolve, 10))

      expect(rejected).toBeInstanceOf(ResultDecodeError)
      expect(later).toBeInstanceOf(ResultDecodeError)
      expect(ofAnotherRealm).toBeInstanceOf(ResultDecodeError)
      expect(unhandled).toEqual([])
    } finally {
      process.off("unhandledRejection", onUnhandled)
    }
  })

  it("does not execute a bound query that a callback returned", async () => {
    const { db, statements } = connect([["a"]])

    const error = await captureFailure(
      db.form.pluck("name").transform((): unknown => db.form.count()),
    )

    expect(error).toBeInstanceOf(ResultDecodeError)
    expect(statements).toHaveLength(1)
  })

  it("rejects with ResultDecodeError when a callback throws, with its error as the cause", async () => {
    const { db } = connect([["a"]])
    const failure = new Error("Boom")

    const error = await captureFailure(
      db.form.pluck("name").map(() => {
        throw failure
      }),
    )

    expect(error).toBeInstanceOf(ResultDecodeError)
    expect(error?.cause).toBe(failure)
    expect(error?.path).toBe("[0]")
  })
})

describe("mutations", () => {
  const values = { id: 1, name: "a" }

  it("keep the SQL of the mutation", () => {
    const insert = schema.form.insert(values).select("id")

    expect(insert.map(String).toSQL()).toEqual(insert.toSQL())
    expect(insert.transform(String).toSQL()).toEqual(insert.toSQL())
  })

  it("map the records and the values that they return", async () => {
    expect(
      await connect([["1", "a"]])
        .db.form.insert(values)
        .select("id", "name")
        .map(row => `${row.id}: ${row.name}`),
    ).toBe("1: a")
    expect(
      await connect([["1"], ["2"]])
        .db.form.where({ id: 1 })
        .delete()
        .pluck("id")
        .map(id => id + 1)
        .map(String),
    ).toEqual(["2", "3"])
  })

  it("transform the number of the rows, in every rows mode, whose checks come first", async () => {
    const { db } = connect([], 2)

    expect(
      await db.form
        .where({ id: 1 })
        .update({ name: "a" })
        .transform(count => count > 0),
    ).toBe(true)
    expect(
      await connect([], 1)
        .db.form.find(1)
        .delete()
        .transform(count => count + 1)
        .transform(String),
    ).toBe("2")
    expect(
      await connect([], 0)
        .db.form.find(1)
        .optional()
        .delete()
        .transform(count => count === 0),
    ).toBe(true)
    expect(
      await captureFailure(connect([], 0).db.form.find(1).delete().transform(failOnCall)),
    ).toBeInstanceOf(NotFoundError)
  })

  it("convert records without fields, without calling map for a missing one", async () => {
    const { db: zero } = connect([], 0)
    const { db: two } = connect([], 2)

    expect(await zero.form.find(1).optional().delete().select().map(failOnCall)).toBeUndefined()
    expect(
      await zero.form
        .find(1)
        .nullable()
        .delete()
        .select()
        .transform(row => row === null),
    ).toBe(true)
    expect(
      await two.form
        .where({ id: 1 })
        .delete()
        .select()
        .map(row => Object.keys(row).length),
    ).toEqual([0, 0])
  })

  it("reject map of a mutation that returns the number of its rows, and map after transform", () => {
    const update = schema.form.find(1).update({ name: "a" })
    const transformed = update.select("id").transform(String)

    // @ts-expect-error `map` needs the fields of the rows.
    expect(() => update.map(String)).toThrow(
      "map applies only to a mutation that returns the fields of its rows",
    )
    // @ts-expect-error `map` does not apply after `transform`.
    expect(() => transformed.map(String)).toThrow("map cannot be used after transform")
  })

  it("reject the methods that change what they return after a conversion", () => {
    const mapped = schema.form.insert(values).select("id").map(String)
    const transformed = schema.form.insert(values).select("id").transform(String)
    const message = "cannot be used after map or transform; call it before them"

    for (const query of [mapped, transformed]) {
      // @ts-expect-error `select` does not apply after a conversion.
      expect(() => query.select("name")).toThrow(`select ${message}`)
      // @ts-expect-error `get` does not apply after a conversion.
      expect(() => query.get("name")).toThrow(`get ${message}`)
      // @ts-expect-error `pluck` does not apply after a conversion.
      expect(() => query.pluck("name")).toThrow(`pluck ${message}`)
    }
  })

  it("stay rejected as a field and as an operand", () => {
    const value = schema.form.insert(values).get("id").map(String)
    const fields = () => ({
      id: value,
    })

    // @ts-expect-error A selection takes no mutation.
    expect(() => from(form).select(fields)).toThrow("which cannot be nested")
    expect(() =>
      // @ts-expect-error A mutation is not an operand.
      not(value),
    ).toThrow("not a query of insert, update, or delete")
  })

  it("reject with ResultDecodeError when a callback throws, after the statement", async () => {
    const { db, statements } = connect([["1"]])
    const failure = new Error("Boom")
    const throwFailure = () => {
      throw failure
    }

    for (const query of [
      db.form.insert(values).get("id").map(throwFailure),
      db.form.insert(values).get("id").transform(throwFailure),
    ]) {
      const error = await captureFailure(query)

      expect(error).toBeInstanceOf(ResultDecodeError)
      expect(error?.cause).toBe(failure)
      expect(error?.path).toBeUndefined()
    }
    expect(statements).toHaveLength(2)
    const count = await captureFailure(
      connect([], 1).db.form.find(1).delete().transform(throwFailure),
    )
    expect(count).toBeInstanceOf(ResultDecodeError)
    expect(count?.cause).toBe(failure)
  })
})

describe("helpers", () => {
  const withSlug = defineHelper(schema.form, (query, prefix: string) =>
    query.select("id", "name").map(row => ({ ...row, slug: `${prefix}-${row.name}` })),
  )

  it("apply select and map to a query of a table and to a mutation alike", async () => {
    const view = { id: 1, name: "a", slug: "x-a" }

    expect(
      await connect([["1", "a"]])
        .db.form.find(1)
        .use(withSlug, "x"),
    ).toEqual(view)
    expect(
      await connect([["1", "a"]])
        .db.form.insert({ id: 1, name: "a" })
        .use(withSlug, "x"),
    ).toEqual(view)
    expect(
      await connect([["1", "a"]])
        .db.form.find(1)
        .update({ name: "a" })
        .use(withSlug, "x"),
    ).toEqual(view)
    expect(
      await connect([["1", "a"]])
        .db.form.where({ id: 1 })
        .delete()
        .use(withSlug, "x"),
    ).toEqual([view])
  })

  it("keep the SQL that select gives there", () => {
    const fields = schema.form.select("id", "name")
    const insert = schema.form.insert({ id: 1, name: "a" })

    expect(schema.form.use(withSlug, "x").toSQL()).toEqual(fields.toSQL())
    expect(insert.use(withSlug, "x").toSQL()).toEqual(insert.select("id", "name").toSQL())
  })

  it("take the methods that keep the fields after them on a query of a table", () => {
    const fields = schema.form.select("id", "name")

    expect(
      schema.form.use(withSlug, "x").where({ name: "a" }).orderBy("name").limit(1).toSQL(),
    ).toEqual(fields.where({ name: "a" }).orderBy("name").limit(1).toSQL())
  })

  it("reject on a mutation map without fields to read, which types do not tell", () => {
    const insert = schema.form.insert({ id: 1, name: "a" })
    const mapped = defineHelper(schema.form, query => query.map(String))
    const mappedEmpty = defineHelper(schema.form, query => query.select(() => ({})).map(String))

    expect(() => insert.use(mapped)).toThrow(
      "map applies only to a mutation that returns the fields of its rows",
    )
    expect(() => insert.use(mappedEmpty)).toThrow(
      "The callback of use must select at least one field",
    )
  })

  it("apply through a callback of use of a mutation", async () => {
    const { db } = connect([["1"]])

    expect(
      await db.form.insert({ id: 1, name: "a" }).use(query => query.get("id").map(String)),
    ).toBe("1")
  })
})

describePostgres("in PostgreSQL", ({ database, testTransaction }) => {
  const db = bindSchema(schema, database)

  /** Runs `body` in a transaction with forms and their fields. */
  function withForms<T>(body: () => Promise<T>): Promise<T> {
    return testTransaction(async () => {
      await db.$query`CREATE TEMP TABLE form (id integer PRIMARY KEY, name text NOT NULL) ON COMMIT DROP`
      await db.$query`CREATE TEMP TABLE field (id integer PRIMARY KEY, form_id integer NOT NULL, label text NOT NULL, hint text) ON COMMIT DROP`
      await db.$query`INSERT INTO form VALUES (1, 'Survey'), (2, 'Feedback')`
      await db.$query`INSERT INTO field VALUES (1, 1, 'Age', NULL), (2, 1, 'City', 'Where you live')`
      return await body()
    })
  }

  it("converts the value of an aggregate with a fallback", () =>
    withForms(async () => {
      const next = await db.field
        .max("id")
        .coalesce(0)
        .transform(position => position + 1)
      expect(next).toBe(3)
    }))

  it("maps records and the row of a query of one row", () =>
    withForms(async () => {
      const toView = (row: { id: number; name: string }) => ({ ...row, slug: toUpper(row.name) })

      expect(await db.form.select("id", "name").orderBy("id").map(toView)).toEqual([
        { id: 1, name: "Survey", slug: "SURVEY" },
        { id: 2, name: "Feedback", slug: "FEEDBACK" },
      ])
      expect(await db.form.select("id", "name").find(2).map(toView)).toEqual({
        id: 2,
        name: "Feedback",
        slug: "FEEDBACK",
      })
    }))

  it("takes the methods that keep the fields after map, as it takes them before it", () =>
    withForms(async () => {
      const names = db.form.select("name").map(row => toUpper(row.name))

      expect(await names.orderBy("id")).toEqual(["SURVEY", "FEEDBACK"])
      expect(
        await names
          .orderBy(columns => columns.id)
          .limit(1)
          .offset(1),
      ).toEqual(["FEEDBACK"])
      expect(await names.where({ id: 1 })).toEqual(["SURVEY"])
      expect(await names.find(1)).toBe("SURVEY")
      expect(await names.findBy({ id: 2 })).toBe("FEEDBACK")
      expect(await names.where({ id: 3 }).take().optional()).toBeUndefined()
      expect(await names.where({ id: 3 }).take().nullable()).toBeNull()
      expect(await captureFailure(names.find(3))).toBeInstanceOf(NotFoundError)
    }))

  it("ends the guarantee of a required relation by a filter after map, whose missing row is null", () =>
    withForms(async () => {
      expect(
        await db.field.find(1).select(columns => ({
          record: columns.form
            .select("name")
            .map(row => row.name)
            .where({ id: 9 }),
          value: columns.form.get("name").map(toUpper).where({ id: 9 }),
        })),
      ).toEqual({ record: null, value: null })
    }))

  it("skips a missing row in map and passes it to transform", () =>
    withForms(async () => {
      const missing = db.form.where({ id: 3 }).take()

      expect(await missing.select("name").optional().map(failOnCall)).toBeUndefined()
      expect(await missing.select("name").nullable().map(failOnCall)).toBeNull()
      expect(await missing.pluck("name").optional().map(failOnCall)).toBeUndefined()
      expect(
        await missing
          .select("name")
          .nullable()
          .transform(row => row?.name ?? "none"),
      ).toBe("none")
      expect(
        await missing
          .get("name")
          .optional()
          .transform(name => name ?? "none"),
      ).toBe("none")
      expect(await captureFailure(missing.get("name").map(failOnCall))).toBeInstanceOf(
        NotFoundError,
      )
    }))

  it("passes a NULL value to map, which is not a missing row", () =>
    withForms(async () => {
      expect(
        await db.field
          .orderBy("id")
          .pluck("hint")
          .map(hint => hint ?? "none"),
      ).toEqual(["none", "Where you live"])
      expect(
        await db.field
          .where({ id: 3 })
          .max("id")
          .map(max => max ?? 0),
      ).toBe(0)
    }))

  it("converts nested rows of each rows mode", () =>
    withForms(async () => {
      const forms = await db.form.orderBy("id").select(columns => ({
        id: columns.id,
        labels: columns.fields.orderBy("id").pluck("label").map(toUpper),
        joined: columns.fields
          .orderBy("id")
          .pluck("label")
          .transform(labels => labels.join()),
        first: columns.fields
          .orderBy("id")
          .take()
          .select("label")
          .optional()
          .map(row => row.label),
        nothing: columns.fields
          .orderBy("id")
          .take()
          .select("label")
          .nullable()
          .transform(row => row === null),
      }))

      expect(forms).toEqual([
        { id: 1, labels: ["AGE", "CITY"], joined: "Age,City", first: "Age", nothing: false },
        { id: 2, labels: [], joined: "", first: undefined, nothing: true },
      ])
    }))

  it("converts a nested aggregate and exists, which become packed rows", () =>
    withForms(async () => {
      const forms = await db.form.orderBy("id").select(columns => ({
        count: columns.fields.count().map(count => count + 1),
        largest: columns.fields
          .max("id")
          .coalesce(0)
          .transform(id => id * 2),
        has: columns.fields.exists().transform(has => (has ? "yes" : "no")),
        plain: columns.fields.count(),
      }))

      expect(forms).toEqual([
        { count: 3, largest: 4, has: "yes", plain: 2 },
        { count: 1, largest: 0, has: "no", plain: 0 },
      ])
    }))

  it("converts the nested rows of a required relation, and keeps its error for a missing record", () =>
    withForms(async () => {
      expect(
        await db.field.find(1).select(columns => ({
          form: columns.form.select("name").map(row => row.name),
        })),
      ).toEqual({ form: "Survey" })

      await db.$query`INSERT INTO field VALUES (3, 9, 'Orphan', NULL)`
      const error = await captureFailure(
        db.field.find(3).select(columns => ({
          form: columns.form.select("name").map(row => row.name),
        })),
      )
      expect(error).toBeInstanceOf(RequiredRelationError)
    }))

  it("converts a nested query of a page after an offset", () =>
    withForms(async () => {
      expect(
        await db.form
          .orderBy("id")
          .offset(1)
          .select(columns => ({
            id: columns.id,
            count: columns.fields.count().transform(count => count + 10),
          })),
      ).toEqual([{ id: 2, count: 10 }])
    }))

  it("converts records whose fields hold nested conversions", () =>
    withForms(async () => {
      expect(
        await db.form
          .find(1)
          .select(columns => ({
            labels: columns.fields
              .orderBy("id")
              .select("label")
              .map(row => row.label),
          }))
          .map(row => row.labels.join()),
      ).toBe("Age,City")
    }))

  it("nests a converted query in $select and in the fields that a mutation returns", () =>
    withForms(async () => {
      expect(
        await db.$select({
          total: db.form.count().transform(count => count * 10),
        }),
      ).toEqual({ total: 20 })
      expect(
        await db.form
          .find(1)
          .update({ name: "Renamed" })
          .select(columns => ({
            labels: columns.fields.orderBy("id").pluck("label").map(toUpper),
          })),
      ).toEqual({ labels: ["AGE", "CITY"] })
    }))

  it("names the path of a failure of a nested conversion", () =>
    withForms(async () => {
      const error = await captureFailure(
        db.form.find(1).select(columns => ({
          labels: columns.fields
            .orderBy("id")
            .pluck("label")
            .map(label => {
              if (label === "City") {
                throw new Error("Boom")
              }
              return label
            }),
        })),
      )

      expect(error).toBeInstanceOf(ResultDecodeError)
      expect(error?.path).toBe("labels[1]")
    }))

  describe("mutations", () => {
    const withView = defineHelper(schema.form, query =>
      query
        .select("id", "name")
        .select(columns => ({
          fieldCount: columns.fields.count(),
        }))
        .map(row => ({ ...row, title: toUpper(row.name) })),
    )

    it("convert what they return, and the number of the rows", () =>
      withForms(async () => {
        expect(
          await db.form
            .insert({ id: 3, name: "New" })
            .select("id", "name")
            .map(row => `${row.id}: ${row.name}`),
        ).toBe("3: New")
        expect(await db.form.find(3).update({ name: "Newer" }).get("name").transform(toUpper)).toBe(
          "NEWER",
        )
        expect(
          await db.form
            .where({ id: 3 })
            .delete()
            .transform(count => count === 1),
        ).toBe(true)
        expect(
          await db.form
            .where({ id: 3 })
            .update({ name: "None" })
            .select("id")
            .transform(rows => rows.length),
        ).toBe(0)
      }))

    it("apply one helper of select and map to a query of a table, an insert, and an update", () =>
      withForms(async () => {
        const survey = { id: 1, name: "Survey", fieldCount: 2, title: "SURVEY" }

        expect(await db.form.find(1).use(withView)).toEqual(survey)
        expect(await db.form.use(withView).where({ id: 1 }).orderBy("id")).toEqual([survey])
        expect(await db.form.insert({ id: 3, name: "New" }).use(withView)).toEqual({
          id: 3,
          name: "New",
          fieldCount: 0,
          title: "NEW",
        })
        expect(await db.form.find(1).update({ name: "Renamed" }).use(withView)).toEqual({
          id: 1,
          name: "Renamed",
          fieldCount: 2,
          title: "RENAMED",
        })
      }))

    it("keep the change when a callback fails after the statement", () =>
      withForms(async () => {
        const error = await captureFailure(
          db.form.insert({ id: 3, name: "New" }).get("id").map(failOnCall),
        )

        expect(error).toBeInstanceOf(ResultDecodeError)
        expect(await db.form.find(3).get("name")).toBe("New")
      }))
  })
})
