import { describe, expectTypeOf, test } from "bun:test"

import type { Driver } from "../database/driver"
import { createDatabase } from "../execution/database"
import { many, one } from "../schema/relation"
import { defineSchema } from "../schema/schema"
import { defineTable } from "../table/table"
import * as t from "../types"

import type { TransformedQuery, TransformedQueryState } from "./conversion"
import { defineHelper } from "./helper"
import type { SelectQueryKind } from "./kind"
import type { ResultOf } from "./select"
import { from } from "./select"

const form = defineTable("form", {
  id: t.integer.primaryKey(),
  name: t.text,
})

const field = defineTable("field", {
  id: t.integer.primaryKey(),
  formId: t.integer,
  label: t.text,
  hint: t.text.nullable(),
  details: t.jsonb,
})

const other = defineTable("other", {
  id: t.integer.primaryKey(),
})

const schema = defineSchema({ form, field }).$relations({
  form: {
    fields: many(field, { from: "id", to: "formId" }),
  },
  field: {
    form: one(form, { from: "formId", to: "id", required: true }),
  },
})

declare const driver: Driver
const database = createDatabase({ driver })
const db = database.bind(schema)

describe("map", () => {
  test("takes each record or value and gives the rows of its result in the rows mode of the query", async () => {
    expectTypeOf(
      await db.form.select("id", "name").map(row => {
        expectTypeOf(row).toEqualTypeOf<{ id: number; name: string }>()
        return row.name.length
      }),
    ).toEqualTypeOf<number[]>()
    expectTypeOf(
      await db.form
        .find(1)
        .select("name")
        .map(row => row.name),
    ).toEqualTypeOf<string>()
    expectTypeOf(await db.form.pluck("name").map(name => name.length)).toEqualTypeOf<number[]>()
    expectTypeOf(
      await db.form
        .find(1)
        .get("name")
        .map(name => name.length),
    ).toEqualTypeOf<number>()
  })

  test("keeps a missing row out of the callback and in the result", async () => {
    const take = db.form.take().select("name")

    expectTypeOf(
      await take.optional().map(row => {
        expectTypeOf(row).toEqualTypeOf<{ name: string }>()
        return row.name
      }),
    ).toEqualTypeOf<string | undefined>()
    expectTypeOf(await take.nullable().map(row => row.name)).toEqualTypeOf<string | null>()
    expectTypeOf(
      await db.form
        .take()
        .get("name")
        .optional()
        .map(name => name.length),
    ).toEqualTypeOf<number | undefined>()
  })

  test("gives the callback a NULL value as null", async () => {
    expectTypeOf(
      await db.field.pluck("hint").map(hint => {
        expectTypeOf(hint).toEqualTypeOf<string | null>()
        return hint ?? "none"
      }),
    ).toEqualTypeOf<string[]>()
    expectTypeOf(
      await db.field.max("id").map(max => {
        expectTypeOf(max).toEqualTypeOf<number | null>()
        return max ?? 0
      }),
    ).toEqualTypeOf<number>()
  })

  test("takes the callback with one parameter", () => {
    void db.form.pluck("name").map(
      // @ts-expect-error The callback has no index of the row.
      (name: string, index: number) => `${index}: ${name}`,
    )
  })

  test("takes the result of the earlier map", async () => {
    expectTypeOf(
      await db.form
        .pluck("name")
        .map(name => name.length)
        .map(length => {
          expectTypeOf(length).toEqualTypeOf<number>()
          return length > 1
        }),
    ).toEqualTypeOf<boolean[]>()
  })

  test("keeps the kind of the query", () => {
    expectTypeOf(from(form).pluck("name").map(String).then).toBeUndefined()
    expectTypeOf(schema.form.pluck("name").map(String).then).toBeUndefined()
    expectTypeOf(db.form.pluck("name").map(String).db).not.toBeUndefined()
  })

  describe("methods after it", () => {
    const names = db.form.select("name").map(row => row.name.length)

    test("that keep the fields apply, and keep the result of the callback", async () => {
      expectTypeOf(await names.where({ id: 1 })).toEqualTypeOf<number[]>()
      expectTypeOf(await names.where(columns => columns.id.eq(1))).toEqualTypeOf<number[]>()
      expectTypeOf(await names.orderBy("name", { id: "desc" })).toEqualTypeOf<number[]>()
      expectTypeOf(await names.orderBy(columns => columns.name)).toEqualTypeOf<number[]>()
      expectTypeOf(await names.limit(1).offset(2)).toEqualTypeOf<number[]>()
      expectTypeOf(await names.distinct()).toEqualTypeOf<number[]>()
      expectTypeOf(await names.find(1)).toEqualTypeOf<number>()
      expectTypeOf(await names.findBy({ id: 1 })).toEqualTypeOf<number>()
      expectTypeOf(await names.take()).toEqualTypeOf<number>()
      expectTypeOf(await names.take().optional()).toEqualTypeOf<number | undefined>()
      expectTypeOf(await names.take().required()).toEqualTypeOf<number>()
      expectTypeOf(await names.use(query => query.where({ id: 1 }))).toEqualTypeOf<number[]>()
    })

    test("that keep the fields end the guarantee of a required relation", async () => {
      expectTypeOf(
        await db.field.select(columns => ({
          record: columns.form
            .select("name")
            .map(row => row.name)
            .where({ id: 1 }),
          value: columns.form
            .get("name")
            .map(name => name.length)
            .where({ id: 1 }),
          kept: columns.form.select("name").map(row => row.name),
        })),
      ).toEqualTypeOf<{ record: string | null; value: number | null; kept: string }[]>()
    })

    test("orderBy rejects the fields selected before it, which the result no longer tells", () => {
      void names.orderBy(
        // @ts-expect-error The callback of `orderBy` has no selected fields after `map`.
        (columns, selected) => selected,
      )
      void db.form
        .pluck("name")
        .map(String)
        .orderBy(
          // @ts-expect-error The callback of `orderBy` has no value after `map`.
          (columns, value) => value,
        )
    })

    test("that read or change the fields reject it", () => {
      // @ts-expect-error `select` does not apply after `map`.
      void names.select("id")
      // @ts-expect-error `clearSelect` does not apply after `map`.
      void names.clearSelect()
      // @ts-expect-error `get` does not apply after `map`.
      void names.get("id")
      // @ts-expect-error `pluck` does not apply after `map`.
      void names.pluck("id")
      // @ts-expect-error `count` does not apply after `map`.
      void names.count()
      // @ts-expect-error `max` does not apply after `map`.
      void names.max("id")
      // @ts-expect-error `exists` does not apply after `map`.
      void names.exists()
      // @ts-expect-error `coalesce` does not apply after `map`.
      void db.form.pluck("name").map(String).coalesce("a")
      // @ts-expect-error `expr` does not apply after `map`.
      void db.form.find(1).get("name").map(String).expr()
    })
  })
})

describe("transform", () => {
  test("takes the whole result and gives the result of the query", async () => {
    expectTypeOf(
      await db.form.select("id", "name").transform(rows => {
        expectTypeOf(rows).toEqualTypeOf<{ id: number; name: string }[]>()
        return new Map(rows.map(row => [row.id, row.name]))
      }),
    ).toEqualTypeOf<Map<number, string>>()
    expectTypeOf(
      await db.form
        .find(1)
        .get("name")
        .transform(name => name.length),
    ).toEqualTypeOf<number>()
    expectTypeOf(
      await db.form
        .take()
        .select("name")
        .optional()
        .transform(row => {
          expectTypeOf(row).toEqualTypeOf<{ name: string } | undefined>()
          return row?.name ?? null
        }),
    ).toEqualTypeOf<string | null>()
    expectTypeOf(
      await db.form
        .take()
        .select("name")
        .nullable()
        .transform(row => {
          expectTypeOf(row).toEqualTypeOf<{ name: string } | null>()
          return row === null
        }),
    ).toEqualTypeOf<boolean>()
  })

  test("takes the value of an aggregate with a fallback", async () => {
    expectTypeOf(
      await db.field
        .max("id")
        .coalesce(0)
        .transform(position => {
          expectTypeOf(position).toEqualTypeOf<number>()
          return position + 1
        }),
    ).toEqualTypeOf<number>()
  })

  test("takes the result of map and of an earlier transform", async () => {
    expectTypeOf(
      await db.form
        .pluck("name")
        .map(name => name.length > 1)
        .transform(values => {
          expectTypeOf(values).toEqualTypeOf<boolean[]>()
          return values.length
        })
        .transform(count => {
          expectTypeOf(count).toEqualTypeOf<number>()
          return String(count)
        }),
    ).toEqualTypeOf<string>()
    expectTypeOf(
      await db.form
        .take()
        .get("name")
        .optional()
        .map(name => name.length)
        .transform(length => {
          expectTypeOf(length).toEqualTypeOf<number | undefined>()
          return length ?? 0
        }),
    ).toEqualTypeOf<number>()
  })

  test("gives a query that takes no other method, which would change what its callback receives", () => {
    const transformed = db.form.select("id").transform(rows => rows.length)

    // @ts-expect-error `map` does not apply after `transform`.
    void transformed.map
    // @ts-expect-error A query of `transform` has no `where`.
    void transformed.where
    // @ts-expect-error A query of `transform` has no `select`.
    void transformed.select
    // @ts-expect-error A query of `transform` has no `take`.
    void transformed.take
    // @ts-expect-error A query of `transform` has no `orderBy`.
    void transformed.orderBy
    // @ts-expect-error A query of `transform` has no `count`.
    void transformed.count
    // @ts-expect-error A query of `transform` has no `exists`.
    void transformed.exists
    // @ts-expect-error A query of `transform` has no `use`.
    void transformed.use
    // @ts-expect-error A query of `transform` has no `update`.
    void transformed.update
  })

  test("keeps the kind of the query", async () => {
    type Either = TransformedQuery<
      TransformedQueryState<typeof form, string, never>,
      SelectQueryKind
    >
    const either: Either = from(form).count().transform(String)

    expectTypeOf(from(form).count().transform(String)).toEqualTypeOf<
      TransformedQuery<TransformedQueryState<typeof form, string, never>, "unbound">
    >()
    expectTypeOf(db.form.count().transform(String)).toEqualTypeOf<
      TransformedQuery<TransformedQueryState<typeof form, string, never>, "bound">
    >()
    expectTypeOf(await db.form.count().transform(String)).toEqualTypeOf<string>()
    // @ts-expect-error A query of either kind may execute when awaited.
    await either
  })

  test("reads the result as ResultOf of a query", () => {
    const transformed = db.form.select("id").transform(rows => rows.length)

    expectTypeOf<ResultOf<typeof transformed>>().toEqualTypeOf<number>()
  })
})

describe("synchronous results", () => {
  const mapped = db.form.pluck("name").map(String)

  test("reject a callback that returns a Promise", () => {
    void db.form.pluck("name").map(
      // @ts-expect-error A callback returns its result synchronously.
      async name => name,
    )
    void db.form.pluck("name").transform(
      // @ts-expect-error A callback returns its result synchronously.
      async names => names,
    )
    void db.form.pluck("name").map(
      // @ts-expect-error A callback returns its result synchronously.
      name => (name ? name : Promise.resolve(name)),
    )
    void mapped.map(
      // @ts-expect-error A callback returns its result synchronously.
      async name => name,
    )
    void mapped.transform(
      // @ts-expect-error A callback returns its result synchronously.
      async names => names,
    )
    void mapped
      .transform(names => names)
      .transform(
        // @ts-expect-error A callback returns its result synchronously.
        async names => names,
      )
    void db.form.select(columns => ({
      labels: columns.fields.pluck("label").map(
        // @ts-expect-error A callback returns its result synchronously.
        async label => label,
      ),
    }))
    void db.form
      .insert({ id: 1, name: "a" })
      .get("id")
      .map(
        // @ts-expect-error A callback returns its result synchronously.
        async id => id,
      )
    void db.form
      .find(1)
      .delete()
      .transform(
        // @ts-expect-error A callback returns its result synchronously.
        async count => count,
      )
  })

  test("reject a callback that returns a bound query, which executes when awaited, and take an unbound one", () => {
    void db.form.count().transform(
      // @ts-expect-error A callback returns its result synchronously.
      () => db.form.count(),
    )
    void db.form.count().transform(() => schema.form.count())
  })

  test("take any other result, also of a type that tells nothing", async () => {
    const parse = (text: string): unknown => JSON.parse(text)
    const read = (text: string) => JSON.parse(text)
    const fail = (): never => {
      throw new Error("Failure")
    }

    expectTypeOf(await db.form.pluck("name").map(parse)).toEqualTypeOf<unknown[]>()
    // oxlint-disable-next-line typescript/no-explicit-any -- what `JSON.parse` returns
    expectTypeOf(await db.form.pluck("name").map(read)).toEqualTypeOf<any[]>()
    expectTypeOf(await db.form.count().transform(fail)).toEqualTypeOf<never>()
    expectTypeOf(await db.form.count().transform(() => undefined)).toEqualTypeOf<undefined>()
    expectTypeOf(await db.form.count().map(() => "text")).toEqualTypeOf<string>()
    // oxlint-disable-next-line unicorn/no-thenable -- a member `then` that is not a function does not make the result awaitable
    expectTypeOf(await db.form.count().map(() => ({ then: "text" }))).toEqualTypeOf<{
      then: string
    }>()
  })
})

describe("$execute and $compile of a Db", () => {
  test("give the result of an unbound query", () => {
    const query = schema.form.pluck("name").map(name => name.length)

    expectTypeOf(db.$execute(query)).toEqualTypeOf<Promise<number[]>>()
    expectTypeOf(db.$compile(query)).toEqualTypeOf<ReturnType<typeof db.$compile>>()
    expectTypeOf(db.$execute(query.where({ id: 1 }))).toEqualTypeOf<Promise<number[]>>()
    expectTypeOf(db.$execute(query.transform(values => values.length))).toEqualTypeOf<
      Promise<number>
    >()
  })

  test("reject a query of a table outside the schema", () => {
    const mapped = from(other).pluck("id").map(String)
    const transformed = from(other).pluck("id").transform(String)

    // @ts-expect-error The schema has no table `other`.
    void db.$execute(mapped)
    // @ts-expect-error The schema has no table `other`.
    db.$compile(mapped)
    // @ts-expect-error The schema has no table `other`.
    void db.$execute(transformed)
  })

  test("reject a query of a relation that the schema of the Db lacks", () => {
    const plainDb = database.bind(defineSchema({ form, field }))
    const mapped = schema.form
      .select(columns => ({
        fields: columns.fields.pluck("id"),
      }))
      .map(row => row.fields.length)

    // @ts-expect-error The schema has no relation `form.fields`.
    void plainDb.$execute(mapped)
    // @ts-expect-error The schema has no relation `form.fields`.
    void plainDb.$execute(mapped.transform(values => values.length))
    db.$compile(mapped)
  })
})

describe("nesting", () => {
  test("a field of a selection has the converted result", async () => {
    expectTypeOf(
      await db.form.select(columns => ({
        labels: columns.fields.pluck("label").map(label => label.length),
        joined: columns.fields.pluck("label").transform(labels => labels.join()),
        first: columns.fields
          .take()
          .select("label")
          .optional()
          .map(row => row.label),
        count: columns.fields.count().map(count => count + 1),
      })),
    ).toEqualTypeOf<
      {
        labels: number[]
        joined: string
        first: string | undefined
        count: number
      }[]
    >()
  })

  test("a field of $select, and of the fields that a mutation returns, has the converted result", async () => {
    expectTypeOf(
      await db.$select({
        total: db.form.count().transform(count => String(count)),
      }),
    ).toEqualTypeOf<{ total: string }>()
    expectTypeOf(
      await db.form
        .find(1)
        .update({ name: "name" })
        .select(columns => ({
          labels: columns.fields.pluck("label").map(label => label.length),
        })),
    ).toEqualTypeOf<{ labels: number[] }>()
  })

  test("a nested conversion keeps the relations in the state of the query", () => {
    const plainDb = database.bind(defineSchema({ form, field }))
    const query = schema.form.select(columns => ({
      fields: columns.fields.pluck("id").map(String),
    }))

    // @ts-expect-error The schema has no relation `form.fields`.
    void plainDb.$execute(query)
    db.$compile(query)
  })
})

describe("expressions", () => {
  const value = schema.form.find(1).get("name").map(String)
  const values = schema.form.pluck("name").map(String)
  const transformed = schema.form.find(1).get("name").transform(String)

  test("reject a converted query as an operand", () => {
    void from(form).where(columns =>
      // @ts-expect-error A query of `map` is not an operand.
      columns.name.eq(value),
    )
    void from(form).where(columns =>
      // @ts-expect-error A query of `transform` is not an operand.
      columns.name.eq(transformed),
    )
    void from(form).where(columns =>
      // @ts-expect-error A query of `map` is not a query of values.
      columns.name.in(values),
    )
    void from(form).where(
      // @ts-expect-error A query of `map` is not a condition.
      value,
    )
    void from(form).update({
      // @ts-expect-error A query of `map` is not the value of a column.
      name: value,
    })
    // @ts-expect-error The callback of `get` takes no query of `map`.
    void from(form).get(() => value)
    void from(form).orderBy(
      // @ts-expect-error A sort key takes no query of `map`.
      () => value,
    )
  })
})

describe("mutations", () => {
  const values = { id: 1, name: "a" }

  test("map what they return, in the rows mode of the changed rows", async () => {
    expectTypeOf(
      await db.form
        .insert(values)
        .select("id", "name")
        .map(row => {
          expectTypeOf(row).toEqualTypeOf<{ id: number; name: string }>()
          return row.name
        }),
    ).toEqualTypeOf<string>()
    expectTypeOf(
      await db.form
        .insertMany([values])
        .select("id")
        .map(row => row.id),
    ).toEqualTypeOf<number[]>()
    expectTypeOf(
      await db.form
        .find(1)
        .optional()
        .update(values)
        .get("id")
        .map(id => {
          expectTypeOf(id).toEqualTypeOf<number>()
          return String(id)
        })
        .map(id => id.length),
    ).toEqualTypeOf<number | undefined>()
    expectTypeOf(
      await db.form
        .where({ id: 1 })
        .delete()
        .pluck("id")
        .map(id => String(id)),
    ).toEqualTypeOf<string[]>()
  })

  test("transform the number of the rows and what they return", async () => {
    expectTypeOf(
      await db.form
        .find(1)
        .update(values)
        .transform(count => {
          expectTypeOf(count).toEqualTypeOf<number>()
          return count > 0
        }),
    ).toEqualTypeOf<boolean>()
    expectTypeOf(
      await db.form
        .find(1)
        .optional()
        .delete()
        .select("id")
        .transform(row => {
          expectTypeOf(row).toEqualTypeOf<{ id: number } | undefined>()
          return row?.id ?? 0
        })
        .transform(id => String(id)),
    ).toEqualTypeOf<string>()
    expectTypeOf(
      await db.form
        .insert(values)
        .get("id")
        .map(String)
        .transform(id => id.length),
    ).toEqualTypeOf<number>()
  })

  test("reject map of the number of the rows, and map after transform", () => {
    const update = db.form.find(1).update(values)
    const deletion = db.form.find(1).delete()
    const transformed = db.form.insert(values).get("id").transform(String)

    // @ts-expect-error `map` needs the fields of the rows.
    void update.map(String)
    // @ts-expect-error `map` needs the fields of the rows.
    void deletion.map(String)
    // @ts-expect-error `map` does not apply after `transform`.
    void transformed.map(String)
  })

  test("reject the methods that change what they return after a conversion", () => {
    const mapped = db.form.insert(values).select("id").map(String)
    const transformed = db.form.insert(values).select("id").transform(String)

    // @ts-expect-error `select` does not apply after `map`.
    void mapped.select("name")
    // @ts-expect-error `get` does not apply after `map`.
    void mapped.get("name")
    // @ts-expect-error `pluck` does not apply after `map`.
    void mapped.pluck("name")
    // @ts-expect-error `select` does not apply after `transform`.
    void transformed.select("name")
    // @ts-expect-error `get` does not apply after `transform`.
    void transformed.get("name")
    // @ts-expect-error `pluck` does not apply after `transform`.
    void transformed.pluck("name")
  })

  test("execute through $execute, which checks the relations they select", () => {
    const plainDb = database.bind(defineSchema({ form, field }))
    const query = schema.form
      .insert(values)
      .select(columns => ({
        fieldIds: columns.fields.pluck("id"),
      }))
      .map(row => row.fieldIds.length)

    expectTypeOf(db.$execute(query)).toEqualTypeOf<Promise<number>>()
    // @ts-expect-error The schema has no relation `form.fields`.
    void plainDb.$execute(query)
  })

  test("nest in no selection", () => {
    const fields = () => ({
      id: schema.form.insert(values).get("id").map(String),
    })

    // @ts-expect-error A selection takes no mutation.
    void from(form).select(fields)
  })

  test("use a callback that returns a mutation", async () => {
    expectTypeOf(
      await db.form.insert(values).use(query => {
        expectTypeOf(query).toEqualTypeOf(db.form.insert(values))
        return query.get("id").map(String)
      }),
    ).toEqualTypeOf<string>()
    const returnTable = () => schema.form
    const insert = db.form.insert(values)

    // @ts-expect-error The callback of `use` returns a mutation.
    void insert.use(returnTable)
  })
})

describe("helpers", () => {
  const values = { id: 1, name: "a" }
  const withSlug = defineHelper(schema.form, query =>
    query.select("id", "name").map(row => {
      expectTypeOf(row.id).toEqualTypeOf<number>()
      expectTypeOf(row.name).toEqualTypeOf<string>()
      return { ...row, slug: row.name.toLowerCase() }
    }),
  )
  type View = { id: number; name: string; slug: string }

  test("select and map on a query of a table, without the marker in their result", async () => {
    expectTypeOf(await db.form.use(withSlug)).toEqualTypeOf<View[]>()
    expectTypeOf(await db.form.find(1).use(withSlug)).toEqualTypeOf<View>()
    expectTypeOf(await db.form.take().optional().use(withSlug)).toEqualTypeOf<View | undefined>()
    expectTypeOf(await withSlug(db.form)).toEqualTypeOf<View[]>()
    expectTypeOf(await db.form.select("id").use(withSlug)).toEqualTypeOf<View[]>()
  })

  test("take a result of any type from map", async () => {
    const toLength = defineHelper(schema.form, query =>
      query.select("name").map(row => row.name.length),
    )
    const toLabels = defineHelper(schema.form, query => query.select("name").map(row => [row.name]))

    expectTypeOf(await db.form.use(toLength)).toEqualTypeOf<number[]>()
    expectTypeOf(await db.form.use(toLabels)).toEqualTypeOf<string[][]>()
    expectTypeOf(await db.form.find(1).use(toLabels)).toEqualTypeOf<string[]>()
  })

  test("take the methods that keep the fields after them", async () => {
    expectTypeOf(await db.form.use(withSlug).where({ id: 1 }).orderBy("name")).toEqualTypeOf<
      View[]
    >()
    expectTypeOf(await db.form.use(withSlug).find(1)).toEqualTypeOf<View>()
    expectTypeOf(await db.form.use(withSlug).take().optional()).toEqualTypeOf<View | undefined>()
    void db.form.use(withSlug).orderBy(
      // @ts-expect-error The callback of `orderBy` has no selected fields after `map`.
      (columns, selected) => selected,
    )
    // @ts-expect-error `select` does not apply after `map`.
    void db.form.use(withSlug).select("id")
  })

  test("that filter apply after map, and those that select or map do not", async () => {
    const withFilter = defineHelper(schema.form, query => query.where({ id: 1 }))
    const withName = defineHelper(schema.form, query => query.select("name"))

    expectTypeOf(await db.form.use(withSlug).use(withFilter)).toEqualTypeOf<View[]>()
    // @ts-expect-error A helper cannot select fields on a query that `map` converts.
    void db.form.use(withSlug).use(withName)
    // @ts-expect-error A helper cannot map a query that `map` converts.
    void db.form.use(withSlug).use(withSlug)
  })

  test("that map reject a query of values, whose fields they would read", () => {
    // @ts-expect-error A helper cannot map a query of values.
    void db.form.pluck("id").use(withSlug)
    // @ts-expect-error A helper cannot map the value of an aggregate.
    void db.form.count().use(withSlug)
  })

  test("reject a callback that maps a value, or that transforms", () => {
    // @ts-expect-error A helper returns records.
    defineHelper(schema.form, query => query.pluck("id").map(String))
    // @ts-expect-error A helper returns records.
    defineHelper(schema.form, query => query.count().map(String))
    // @ts-expect-error A helper returns a query of a table, whose effect it reads.
    defineHelper(schema.form, query => query.select("id").transform(rows => rows.length))
    void from(form).use(
      // @ts-expect-error A callback of `use` returns a query of a table.
      query => query.select("id").transform(rows => rows.length),
    )
  })

  test("keep nesting a converted query in the fields they select", async () => {
    const withLabels = defineHelper(schema.form, query =>
      query.select(columns => ({
        labels: columns.fields.pluck("label").map(label => label.length),
      })),
    )

    expectTypeOf(await db.form.use(withLabels)).toEqualTypeOf<{ labels: number[] }[]>()
  })

  describe("on a mutation", () => {
    test("select and map what it returns, in the rows mode of the changed rows", async () => {
      expectTypeOf(await db.form.insert(values).use(withSlug)).toEqualTypeOf<View>()
      expectTypeOf(await db.form.insertMany([values]).use(withSlug)).toEqualTypeOf<View[]>()
      expectTypeOf(await db.form.find(1).update(values).use(withSlug)).toEqualTypeOf<View>()
      expectTypeOf(await db.form.find(1).optional().delete().use(withSlug)).toEqualTypeOf<
        View | undefined
      >()
      expectTypeOf(await db.form.where({ id: 1 }).delete().use(withSlug)).toEqualTypeOf<View[]>()
    })

    test("reject one that selects or maps after a conversion", () => {
      const withName = defineHelper(schema.form, query => query.select("name"))
      const mapped = db.form.insert(values).select("id").map(String)
      const transformed = db.form.insert(values).transform(String)

      // @ts-expect-error A helper cannot select fields after `map`.
      void mapped.use(withName)
      // @ts-expect-error A helper cannot map after `map`.
      void mapped.use(withSlug)
      // @ts-expect-error A helper cannot select fields after `transform`.
      void transformed.use(withName)
    })

    test("keep the kind of the mutation", () => {
      expectTypeOf(schema.form.insert(values).use(withSlug).then).toBeUndefined()
    })
  })
})
