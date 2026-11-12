import { describe, expectTypeOf, test } from "bun:test"

import { createRecordingDriver } from "@kern-orm/test-harness/recording-driver"
import { createDatabase } from "kern-db"

import { bindSchema } from "../execution/db"
import { count, sum } from "../expression/aggregates"
import { sql } from "../expression/sql"
import { many, one } from "../schema/relation"
import { defineSchema } from "../schema/schema"
import { defineTable } from "../table/table"
import * as t from "../types"

import { defineHelper } from "./helper"
import type { SelectQueryKind } from "./kind"
import { desc } from "./order"
import type { QueryResult } from "./rows"
import type { AnySelectQuery, ResultOf, SelectQuery } from "./select"
import { from } from "./select"
import type { NestedQuery } from "./selection"
import type { EmptyRecord, InitialQueryState, QueryStateOf } from "./state"

declare const flag: boolean

const form = defineTable("form", {
  id: t.uuid,
  name: t.text,
  ownerId: t.uuid,
  published: t.boolean,
})
const field = defineTable("field", {
  id: t.uuid,
})

const schema = defineSchema({ form, field })
const db = bindSchema(schema, createDatabase({ driver: createRecordingDriver().driver }))

/** Result of executing query `Q`. */
type Executed<Q extends AnySelectQuery> = QueryResult<Q["types"]>

const withName = defineHelper(schema.form, form => form.where({ published: true }).select("name"))
const first = defineHelper(schema.form, form => form.where({ published: true }).take())

describe("defineHelper", () => {
  test("defines a helper applied to a query of either kind with use or by a call", () => {
    const bound = db.form.select("id").use(withName)
    expectTypeOf<Awaited<typeof bound>>().toEqualTypeOf<{ id: string; name: string }[]>()

    const unbound = schema.form.select("id").use(withName)
    expectTypeOf<Executed<typeof unbound>>().toEqualTypeOf<{ id: string; name: string }[]>()
    expectTypeOf<Awaited<typeof unbound>>().toEqualTypeOf<typeof unbound>()

    const called = withName(db.form.select("id"))
    expectTypeOf<Awaited<typeof called>>().toEqualTypeOf<{ id: string; name: string }[]>()
  })

  test("defines a helper of a table, a table of a schema, or a table of a Db", () => {
    const ofTable = defineHelper(form, form => form.where({ published: true }))
    const ofDb = defineHelper(db.form, form =>
      form.select(columns => ({
        upper: sql(t.text)`upper(${columns.name})`,
      })),
    )

    const query = schema.form.select("id").use(ofTable).use(ofDb)
    expectTypeOf<Executed<typeof query>>().toEqualTypeOf<{ id: string; upper: string }[]>()
    expectTypeOf<Awaited<typeof query>>().toEqualTypeOf<typeof query>()
  })

  test("replaces field types through repeated selections and helpers", () => {
    const withNameLength = defineHelper(schema.form, form =>
      form.select("name").select(columns => ({
        name: sql(t.integer)`length(${columns.name})`,
      })),
    )
    const query = db.form.select("id", "name").use(withNameLength)
    expectTypeOf<Awaited<typeof query>>().toEqualTypeOf<{ id: string; name: number }[]>()

    const named = query.use(withName).use(withName)
    expectTypeOf<Awaited<typeof named>>().toEqualTypeOf<{ id: string; name: string }[]>()
    const called = withNameLength(schema.form.select("name"))
    expectTypeOf<Executed<typeof called>>().toEqualTypeOf<{ name: number }[]>()
  })

  test("applies take, optional, and nullable to the rows of the query", () => {
    const one = db.form.select("id").use(first)
    expectTypeOf<Awaited<typeof one>>().toEqualTypeOf<{ id: string }>()

    const optional = defineHelper(schema.form, form => form.take().optional())
    const record = db.form.select("id").use(optional)
    expectTypeOf<Awaited<typeof record>>().toEqualTypeOf<{ id: string } | undefined>()

    const value = db.form.get("name").optional().use(first)
    expectTypeOf<Awaited<typeof value>>().toEqualTypeOf<string | undefined>()

    const nullable = defineHelper(schema.form, form => form.take().nullable())
    const nullableRecord = db.form.select("id").take().optional().use(nullable)
    expectTypeOf<Awaited<typeof nullableRecord>>().toEqualTypeOf<{ id: string } | null>()
  })

  test("keeps the rows mode of a query of one row through a filter before or after take", () => {
    const takenFirst = defineHelper(schema.form, form => form.take().where({ published: true }))

    const many = db.form.select("id").use(first)
    expectTypeOf<Awaited<typeof many>>().toEqualTypeOf<{ id: string }>()
    const takenMany = db.form.select("id").use(takenFirst)
    expectTypeOf<Awaited<typeof takenMany>>().toEqualTypeOf<{ id: string }>()
    const record = db.form.select("id").take().optional().use(first)
    expectTypeOf<Awaited<typeof record>>().toEqualTypeOf<{ id: string } | undefined>()
    const takenRecord = db.form.select("id").take().optional().use(takenFirst)
    expectTypeOf<Awaited<typeof takenRecord>>().toEqualTypeOf<{ id: string } | undefined>()
    const value = db.form.get("name").optional().use(first)
    expectTypeOf<Awaited<typeof value>>().toEqualTypeOf<string | undefined>()
    const takenValue = db.form.get("name").optional().use(takenFirst)
    expectTypeOf<Awaited<typeof takenValue>>().toEqualTypeOf<string | undefined>()
  })

  test("types required like take, keeping the rows mode of a query of one row", () => {
    const required = defineHelper(schema.form, form => form.take().optional().required())

    const many = db.form.select("id").use(required)
    expectTypeOf<Awaited<typeof many>>().toEqualTypeOf<{ id: string }>()
    // The helper rejects without a row, but its result type still includes undefined.
    const optional = db.form.select("id").take().optional().use(required)
    expectTypeOf<Awaited<typeof optional>>().toEqualTypeOf<{ id: string } | undefined>()
  })

  test("sorts and paginates the rows of the query", () => {
    const page = defineHelper(schema.form, (form, size: number) =>
      form
        .select("name")
        .orderBy((_columns, selected) => desc(selected.name))
        .limit(size),
    )

    const forms = db.form.select("id").use(page, 10)
    expectTypeOf<Awaited<typeof forms>>().toEqualTypeOf<{ id: string; name: string }[]>()
  })

  test("removes the duplicates of the rows of the query", () => {
    const unique = defineHelper(schema.form, form => form.select("name").distinct())

    const forms = db.form.use(unique)
    expectTypeOf<Awaited<typeof forms>>().toEqualTypeOf<{ name: string }[]>()
  })

  test("groups the rows and rejects aggregate or mapped queries", () => {
    const grouped = defineHelper(schema.form, form => form.groupBy("name"))
    const filtered = defineHelper(schema.form, form =>
      form.groupBy("name").having(() => count().gt(1)),
    )

    const forms = db.form.select("name").use(grouped)
    const filteredForms = db.form.select("name").use(filtered)
    expectTypeOf<Awaited<typeof forms>>().toEqualTypeOf<{ name: string }[]>()
    expectTypeOf<Awaited<typeof filteredForms>>().toEqualTypeOf<{ name: string }[]>()

    // @ts-expect-error groupBy rejects an aggregate query.
    db.form.count().use(grouped)
    // @ts-expect-error groupBy rejects a query of exists.
    db.form.exists().use(grouped)
    const mapped = db.form.select("name").map(row => row.name)
    // @ts-expect-error groupBy rejects a converted query.
    mapped.use(grouped)
    db.form.forUpdate().use(grouped)
  })

  test("carries grouping and aggregate fields through helpers in either order", () => {
    const grouped = defineHelper(form, query => query.groupBy("name"))
    const totals = defineHelper(form, query =>
      query.select(columns => ({
        total: sum(columns.name.length()),
      })),
    )
    const before = from(form).use(totals).use(grouped)
    const after = from(form).use(grouped).use(totals)
    const direct = from(form).groupBy("name").use(totals)
    const later = from(form).use(totals).groupBy("name")
    expectTypeOf<ResultOf<typeof before>>().toEqualTypeOf<{ total: number }>()
    expectTypeOf<ResultOf<typeof after>>().toEqualTypeOf<{ total: number }>()
    expectTypeOf<ResultOf<typeof direct>>().toEqualTypeOf<{ total: number }>()
    expectTypeOf<ResultOf<typeof later>>().toEqualTypeOf<{ total: number }>()
    const conditional = defineHelper(form, (query, group: boolean) =>
      group ? query.groupBy("name") : query,
    )
    const maybe = from(form).use(conditional, true).use(totals)
    expectTypeOf<ResultOf<typeof maybe>>().toEqualTypeOf<{ total: number | null }>()
  })

  test("locks the rows of the query", () => {
    const locked = defineHelper(schema.form, form => form.select("name").forUpdate())

    const forms = db.form.select("id").use(locked)
    expectTypeOf<Awaited<typeof forms>>().toEqualTypeOf<{ id: string; name: string }[]>()
  })

  test("applies a helper that adds fields to a query of any result", () => {
    /** State of a query over forms of any result. */
    interface AnyResultState extends InitialQueryState<typeof form> {
      // oxlint-disable-next-line typescript/no-explicit-any -- a query of any result
      readonly result: any
    }
    const query: SelectQuery<AnyResultState> = schema.form.select("id")

    const named = query.use(withName)
    expectTypeOf<ResultOf<typeof named>>().toBeAny()
  })

  test("applies helpers in a function generic over a state that accepts them", () => {
    const nullable = defineHelper(schema.form, form => form.take().nullable())
    function applyHelpers<
      S extends QueryStateOf<typeof form> & { readonly value: false },
      Kind extends SelectQueryKind,
    >(query: SelectQuery<S, Kind>) {
      return {
        used: query.use(withName),
        called: withName(query),
        nullable: query.use(nullable),
      }
    }
    const applied = applyHelpers(db.form.select("id"))
    expectTypeOf<Awaited<typeof applied.used>>().toEqualTypeOf<{ id: string; name: string }[]>()
    expectTypeOf<Awaited<typeof applied.called>>().toEqualTypeOf<{ id: string; name: string }[]>()
    expectTypeOf<Awaited<typeof applied.nullable>>().toEqualTypeOf<{ id: string } | null>()

    function applyToValues<S extends QueryStateOf<typeof form>, Kind extends SelectQueryKind>(
      query: SelectQuery<S, Kind>,
    ) {
      // @ts-expect-error The query may be a query of values.
      void query.use(withName)
      return query.use(first)
    }
    const value = applyToValues(db.form.pluck("name"))
    expectTypeOf<Awaited<typeof value>>().toEqualTypeOf<string>()
  })

  test("applies a helper that adds no fields to a query of values", () => {
    const names = db.form.pluck("name").use(first)
    expectTypeOf<Awaited<typeof names>>().toEqualTypeOf<string>()
  })

  test("keeps an aggregate query through a helper, and aggregates a query of values after one", () => {
    const published = defineHelper(schema.form, form => form.where({ published: true }))

    const count = db.form.pluck("name").use(published).count()
    expectTypeOf<Awaited<typeof count>>().toEqualTypeOf<number>()
    const publishedCount = db.form.count().use(published)
    // @ts-expect-error A query of an aggregate cannot replace it with a value of the rows.
    void publishedCount.get("name")
  })

  test("applies helpers in a chain", () => {
    const chained = db.form.use(withName).use(first).select("id")
    expectTypeOf<Awaited<typeof chained>>().toEqualTypeOf<{ name: string; id: string }>()
  })

  test("applies a helper inside another helper", () => {
    const withNameAndId = defineHelper(schema.form, form => form.use(withName).select("id"))
    const fields = db.form.select("ownerId").use(withNameAndId)
    expectTypeOf<Awaited<typeof fields>>().toEqualTypeOf<
      { ownerId: string; name: string; id: string }[]
    >()

    const firstWithId = defineHelper(schema.form, form => withName(form).use(first).select("id"))
    const record = db.form.select("ownerId").use(firstWithId)
    expectTypeOf<Awaited<typeof record>>().toEqualTypeOf<{
      ownerId: string
      name: string
      id: string
    }>()

    const ownedBy = defineHelper(schema.form, (form, ownerId: string) => form.where({ ownerId }))
    const ownedNames = defineHelper(schema.form, (form, ownerId: string) =>
      form.use(ownedBy, ownerId).use(withName),
    )
    const names = db.form.select("id").use(ownedNames, "owner-id")
    expectTypeOf<Awaited<typeof names>>().toEqualTypeOf<{ id: string; name: string }[]>()

    // @ts-expect-error A helper cannot clear the fields that an inner helper added.
    defineHelper(schema.form, form => form.use(withName).clearSelect())
  })

  test("gives the union of the queries of branches that leave different rows", () => {
    const pick = (single: boolean) =>
      defineHelper(schema.form, form => (single ? form.select("name").take() : form.select("name")))

    const query = db.form.select("id").use(pick(true))
    expectTypeOf<Awaited<typeof query>>().toEqualTypeOf<
      { id: string; name: string } | { id: string; name: string }[]
    >()
  })

  test("keeps a branch that may replace an input field, including through another helper", () => {
    const maybeWithName = defineHelper(schema.form, (form, withName: boolean) =>
      withName ? form.select("name") : form,
    )
    const nested = defineHelper(schema.form, (form, withName: boolean) =>
      form.use(maybeWithName, withName),
    )
    const query = db.form.select(() => ({
      name: sql(t.integer)`1`,
    }))
    const used = query.use(maybeWithName, true)
    const called = maybeWithName(query, true)
    const composed = query.use(nested, true)

    expectTypeOf<Awaited<typeof used>>().toEqualTypeOf<{ name: string }[] | { name: number }[]>()
    expectTypeOf<Awaited<typeof called>>().toEqualTypeOf<Awaited<typeof used>>()
    expectTypeOf<Awaited<typeof composed>>().toEqualTypeOf<Awaited<typeof used>>()

    // @ts-expect-error A branch selects fields on a query of values.
    db.form.get("id").use(maybeWithName, true)
  })

  test("keeps branches selecting a field and a superset of those fields", () => {
    const withIdentity = defineHelper(schema.form, (form, withName: boolean) =>
      withName ? form.select("id", "name") : form.select("id"),
    )
    const query = db.form
      .select(columns => ({
        name: sql(t.integer)`1`,
        ownerId: columns.ownerId,
      }))
      .use(withIdentity, true)

    expectTypeOf<Awaited<typeof query>>().toEqualTypeOf<
      | { id: string; name: number; ownerId: string }[]
      | { id: string; name: string; ownerId: string }[]
    >()
  })

  test("gives the type of a record of the fields that the helper selects with ResultOf", () => {
    expectTypeOf<ResultOf<typeof withName>>().toEqualTypeOf<{ name: string }>()
    expectTypeOf<ResultOf<typeof first>>().toEqualTypeOf<EmptyRecord>()

    const one = defineHelper(schema.form, form => form.select("id", "name").take().optional())
    expectTypeOf<ResultOf<typeof one>>().toEqualTypeOf<{ id: string; name: string }>()

    const slug = defineHelper(schema.form, form =>
      form.select("id", "name").map(row => ({ id: row.id, slug: row.name.toLowerCase() })),
    )
    expectTypeOf<ResultOf<typeof slug>>().toEqualTypeOf<{ id: string; slug: string }>()

    const pick = defineHelper(schema.form, (form, named: boolean) =>
      named ? form.select("name") : form.select("ownerId"),
    )
    expectTypeOf<ResultOf<typeof pick>>().toEqualTypeOf<{ name: string } | { ownerId: string }>()
    const length = defineHelper(schema.form, (form, mapped: boolean) =>
      mapped ? form.select("name").map(row => row.name.length) : form.select("name"),
    )
    expectTypeOf<ResultOf<typeof length>>().toEqualTypeOf<number | { name: string }>()

    // @ts-expect-error ResultOf takes a query or a helper.
    expectTypeOf<ResultOf<(query: number) => number>>().toBeNever()
  })

  test("passes further arguments of the helper", () => {
    const ownedBy = defineHelper(schema.form, (form, ownerId: string) => form.where({ ownerId }))

    const used = db.form.select("id").use(ownedBy, "owner-id")
    expectTypeOf<Awaited<typeof used>>().toEqualTypeOf<{ id: string }[]>()
    const called = ownedBy(db.form.select("id"), "owner-id")
    expectTypeOf<Awaited<typeof called>>().toEqualTypeOf<{ id: string }[]>()

    // @ts-expect-error The argument is a string.
    db.form.use(ownedBy, 1)
    // @ts-expect-error The helper takes an argument.
    db.form.use(ownedBy)
    // @ts-expect-error The helper takes an argument.
    ownedBy(db.form)
  })

  test("passes a query of either kind to the helper", () => {
    defineHelper(schema.form, form => {
      // @ts-expect-error A query of either kind may execute when awaited.
      void (async () => await form)()
      return form
    })
  })

  test("rejects a query that does not accept the effect of the helper", () => {
    // @ts-expect-error A helper cannot select fields on a query of values.
    db.form.pluck("id").use(withName)
    // @ts-expect-error The helper applies to queries over forms.
    db.field.use(withName)

    const pick = (single: boolean) =>
      defineHelper(schema.form, form => (single ? form.take() : form.select("name")))
    // @ts-expect-error A branch selects fields on a query of values.
    db.form.get("name").use(pick(true))
    // @ts-expect-error A branch selects fields on a query of values.
    pick(true)(db.form.get("name"))

    const nullable = defineHelper(schema.form, form => form.take().nullable())
    // @ts-expect-error The value of a missing row is never null.
    db.form.get("name").use(nullable)
  })

  test("rejects a helper that clears the selection or returns values or an aggregate", () => {
    // @ts-expect-error A helper cannot clear the selection.
    defineHelper(schema.form, form => form.clearSelect().select("name"))
    // @ts-expect-error A helper cannot return a query of one value.
    defineHelper(schema.form, form => form.get("name"))
    // @ts-expect-error A helper cannot return a query of values.
    defineHelper(schema.form, form => form.pluck("name"))
    // @ts-expect-error A helper cannot return a query of the number of rows.
    defineHelper(schema.form, form => form.count())
    // @ts-expect-error A helper cannot return a query of an aggregate.
    defineHelper(schema.form, form => form.max("name"))
    // @ts-expect-error A helper cannot return a query it did not receive.
    defineHelper(schema.form, () => schema.form.select("name"))
    const pick = (clear: boolean) =>
      // @ts-expect-error Every branch keeps the selection.
      defineHelper(schema.form, form => (clear ? form.take().clearSelect() : form))
    void pick

    const document = defineTable("document", {
      // oxlint-disable-next-line typescript/no-explicit-any -- a column of values of any type
      payload: t.json.of<any>(),
    })
    // @ts-expect-error A query of one value is rejected even when its result is any.
    defineHelper(document, query => query.get("payload"))
    // @ts-expect-error A query of values is rejected even when its result is any.
    defineHelper(document, query => query.pluck("payload"))
  })

  test("rejects a callback that does not return a query", () => {
    // @ts-expect-error The callback returns a query, not a Promise.
    defineHelper(schema.form, async form => form)
  })
})

describe("queries of a required relation", () => {
  const keyedForm = defineTable("form", {
    id: t.uuid.primaryKey(),
    name: t.text,
    published: t.boolean,
  })
  const formField = defineTable("form_field", {
    id: t.uuid,
    formId: t.uuid,
  })
  const forms = defineSchema({ form: keyedForm, field: formField }).$relations({
    field: {
      form: one(keyedForm, { from: "formId", to: "id", required: true }),
    },
  })
  const published = defineHelper(forms.form, form => form.where({ published: true }))

  test("keeps the record of a required relation unless the helper filters", () => {
    const withName = defineHelper(forms.form, form => form.select("name"))
    const withPublished = defineHelper(forms.form, form => form.use(published))
    const firstPublished = defineHelper(forms.form, form => form.where({ published: true }).take())
    const takenPublished = defineHelper(forms.form, form => form.take().where({ published: true }))
    const takenWithPublished = defineHelper(forms.form, form => form.take().use(published))
    const query = forms.field.select(field => ({
      form: field.form.use(withName),
      published: field.form.use(published).select("name"),
      publishedName: field.form.get("name").use(published),
      inner: field.form.use(withPublished).select("name"),
      firstPublished: field.form.use(firstPublished).select("name"),
      takenPublished: field.form.use(takenPublished).select("name"),
      takenInner: field.form.use(takenWithPublished).select("name"),
    }))

    expectTypeOf<Executed<typeof query>>().toEqualTypeOf<
      {
        form: { name: string }
        published: { name: string } | null
        publishedName: string | undefined
        inner: { name: string } | null
        firstPublished: { name: string } | null
        takenPublished: { name: string } | null
        takenInner: { name: string } | null
      }[]
    >()
  })

  test("makes a value of type never of a required relation optional when the helper filters", () => {
    const failing = t.text.transform({
      decode: (): never => {
        throw new Error("Not decodable")
      },
    })
    const query = forms.field.select(field => ({
      value: field.form.get(() => sql(failing)`'x'`).use(published),
    }))

    expectTypeOf<Executed<typeof query>>().toEqualTypeOf<{ value: undefined }[]>()
  })

  test("makes a value of a query of any result of a required relation optional when the helper filters", () => {
    const query = forms.field.select(field => {
      // oxlint-disable-next-line typescript/no-explicit-any -- a query of any result
      const form: SelectQuery<Omit<typeof field.form.types, "result"> & { readonly result: any }> =
        field.form
      return {
        name: form.use(published).get("name"),
      }
    })

    expectTypeOf<Executed<typeof query>>().toEqualTypeOf<{ name: string | undefined }[]>()
  })

  test("types required like a filter, making the record of a required relation nullable", () => {
    const required = defineHelper(forms.form, form => form.take().required())
    const query = forms.field.select(field => ({
      form: field.form.use(required).select("name"),
    }))

    // The helper rejects without a record, but its result type includes null.
    expectTypeOf<Executed<typeof query>>().toEqualTypeOf<{ form: { name: string } | null }[]>()
  })
})

describe("relations", () => {
  const formField = defineTable("form_field", {
    id: t.uuid,
    formId: t.uuid,
  })
  const forms = defineSchema({ form, field: formField }).$relations({
    form: {
      fields: many(formField, { from: "id", to: "formId" }),
    },
  })
  const answer = defineTable("answer", {
    fieldId: t.uuid,
    value: t.text,
  })
  const tenant = defineSchema(forms, { answer }).$relations({
    field: {
      answers: many(answer, { from: "id", to: "fieldId" }),
    },
  })
  const tenantDb = bindSchema(tenant, createDatabase({ driver: createRecordingDriver().driver }))
  const withFields = defineHelper(forms.form, form =>
    form.select(columns => ({
      fields: columns.fields.select("id"),
    })),
  )

  test("selects the relations of the schema of the query it is defined with", () => {
    const query = tenantDb.form.select("name").use(withFields)
    expectTypeOf<Awaited<typeof query>>().toEqualTypeOf<
      { name: string; fields: { id: string }[] }[]
    >()

    const nested = defineHelper(tenant.field, field =>
      field.select(columns => ({
        answers: columns.answers.pluck("value"),
      })),
    )
    const answers = tenantDb.form.select(form => ({
      fields: form.fields.use(nested),
    }))
    expectTypeOf<Awaited<typeof answers>>().toEqualTypeOf<{ fields: { answers: string[] }[] }[]>()

    defineHelper(form, query =>
      query.select(columns => ({
        // @ts-expect-error A helper of a table has no relations.
        fields: columns.fields,
      })),
    )
  })

  test("gives the records of the relations that the helper selects with ResultOf", () => {
    expectTypeOf<ResultOf<typeof withFields>>().toEqualTypeOf<{ fields: { id: string }[] }>()
  })

  test("selects the relations and the queries of the Db it is defined with", () => {
    const withAnswers = defineHelper(tenantDb.field, field =>
      field.select(columns => ({
        answers: columns.answers.pluck("value"),
        values: tenantDb.answer.where(answer => answer.fieldId.eq(columns.id)).pluck("value"),
      })),
    )
    const query = tenantDb.field.select("id").use(withAnswers)

    expectTypeOf<Awaited<typeof query>>().toEqualTypeOf<
      { id: string; answers: string[]; values: string[] }[]
    >()
  })

  test("applies a helper in a function generic over a state of its schema", () => {
    function applyWithFields<
      S extends QueryStateOf<typeof form, (typeof forms.form)["types"]["schema"]> & {
        readonly value: false
      },
      Kind extends SelectQueryKind,
    >(query: SelectQuery<S, Kind>) {
      return query.use(withFields)
    }
    const query = applyWithFields(tenantDb.form.select("name"))
    expectTypeOf<Awaited<typeof query>>().toEqualTypeOf<
      { name: string; fields: { id: string }[] }[]
    >()

    function applyWithoutRelations<
      S extends QueryStateOf<typeof form> & { readonly value: false },
      Kind extends SelectQueryKind,
    >(query: SelectQuery<S, Kind>) {
      // @ts-expect-error The schema of the query may have no relations.
      return query.use(withFields)
    }
    void applyWithoutRelations
  })

  test("applies a helper that nests a query of other relations, which the Db checks", () => {
    const withForms = defineHelper(forms.field, field =>
      field.select(() => ({
        forms: forms.form.select(form => ({
          fields: form.fields,
        })),
      })),
    )
    const query = forms.field.use(withForms)

    void tenantDb.$execute(query)
    const db = bindSchema(schema, createDatabase({ driver: createRecordingDriver().driver }))
    // @ts-expect-error The schema has no relation `form.fields`.
    void db.$execute(query)
  })

  test("rejects a query of the table under another key, whose relations the callback would read", () => {
    const otherForm = defineTable("other_form", {
      id: t.uuid,
    })
    const moved = defineSchema({ form: otherForm, elsewhere: form, field: formField }).$relations({
      form: {
        fields: many(formField, { from: "id", to: "formId" }),
      },
      elsewhere: {
        drafts: many(formField, { from: "id", to: "formId" }),
      },
    })

    // @ts-expect-error The forms of the helper are under another key, whose relations have no `fields`.
    moved.elsewhere.use(withFields)
  })

  test("rejects a query without the relations of a helper whose nested query has widened relations", () => {
    const widen = (query: NestedQuery): NestedQuery => query
    const withWidened = defineHelper(forms.form, form =>
      form.select(columns => ({
        fields: widen(columns.fields.pluck("id")),
      })),
    )

    forms.form.use(withWidened)
    // @ts-expect-error The schema has no relations.
    schema.form.use(withWidened)
    // @ts-expect-error The schema has no relations.
    withWidened(schema.form)
  })

  test("rejects a query whose schema lacks a relation that the helper selects", () => {
    forms.form.use(withFields)

    // @ts-expect-error A query of from has no relations.
    from(form).use(withFields)
    // @ts-expect-error The schema has no relations.
    schema.form.use(withFields)
    // @ts-expect-error The schema has no relations.
    withFields(schema.form)

    const nested = defineHelper(tenant.field, field =>
      field.select(columns => ({
        answers: columns.answers,
      })),
    )
    forms.form.select(form => ({
      // @ts-expect-error The forms schema has no answers.
      fields: form.fields.use(nested),
    }))
  })

  test("rejects a query whose relation one may miss the record that the relation of the helper requires", () => {
    const owner = defineTable("owner", {
      id: t.uuid.primaryKey(),
      name: t.text,
    })
    const required = defineSchema({ form, owner }).$relations({
      form: {
        owner: one(owner, { from: "ownerId", to: "id", required: true }),
      },
    })
    const maybeRequired = defineSchema({ form, owner }).$relations({
      form: {
        owner: one(owner, { from: "ownerId", to: "id", required: flag }),
      },
    })
    const withOwner = defineHelper(required.form, form =>
      form.select(columns => ({
        owner: columns.owner.select("name"),
      })),
    )
    const withMaybeOwner = defineHelper(maybeRequired.form, form =>
      form.select(columns => ({
        owner: columns.owner.select("name"),
      })),
    )

    const query = required.form.use(withMaybeOwner)
    expectTypeOf<Executed<typeof query>>().toEqualTypeOf<{ owner: { name: string } | null }[]>()
    // @ts-expect-error The relation of the query may miss its record.
    maybeRequired.form.use(withOwner)
    // @ts-expect-error The relation of the query may miss its record.
    withOwner(maybeRequired.form)
  })
})
