import { describe, expectTypeOf, test } from "bun:test"

import { createRecordingDriver } from "../../testing/recording-driver"
import { createDatabase } from "../execution/database"
import { count } from "../expression/aggregates"
import { not } from "../expression/predicates"
import { sql } from "../expression/sql"
import { many, one } from "../schema/relation"
import { defineSchema } from "../schema/schema"
import { defineTable } from "../table/table"
import * as t from "../types"

import { asc, desc } from "./order"
import type { QueryResult } from "./rows"
import type { AnySelectQuery, SelectQuery } from "./select"
import { from } from "./select"
import type { Selection } from "./selection"
import type { EmptyRecord } from "./state"

declare const flag: boolean

const form = defineTable("form", {
  id: t.uuid.primaryKey(),
  name: t.text,
})
const field = defineTable("field", {
  id: t.uuid.primaryKey(),
  formId: t.uuid,
  label: t.text.nullable(),
})
/** An answer keeps its value when its field is removed. */
const answer = defineTable("answer", {
  id: t.uuid.primaryKey(),
  fieldId: t.uuid.nullable(),
  value: t.text,
})

const forms = defineSchema({ form, field }).$relations({
  form: {
    fields: many(field, { from: "id", to: "formId" }),
  },
  field: {
    form: one(form, { from: "formId", to: "id", required: true }),
  },
})
const tenant = defineSchema(forms, { answer }).$relations({
  field: {
    answers: many(answer, { from: "id", to: "fieldId" }),
  },
  answer: {
    field: one(field, { from: "fieldId", to: "id" }),
  },
})
const tenantDb = createDatabase({ driver: createRecordingDriver().driver }).bind(tenant)

/** Result of executing query `Q`. */
type Executed<Q extends AnySelectQuery> = QueryResult<Q["types"]>

/** State `S` with a result of any type. */
// oxlint-disable-next-line typescript/no-explicit-any -- a query of any result
type AnyResult<S> = Omit<S, "result"> & { readonly result: any }

describe("select", () => {
  test("gives the records of a relation many as an array", () => {
    const query = forms.form.select(form => ({
      id: form.id,
      fields: form.fields.select("label"),
    }))

    expectTypeOf<Executed<typeof query>>().toEqualTypeOf<
      { id: string; fields: { label: string | null }[] }[]
    >()
  })

  test("gives the record of a relation one, and null without it unless the relation is required", () => {
    const query = tenant.answer.select(answer => ({
      field: answer.field.select("label").select(field => ({
        form: field.form.select("name"),
      })),
    }))

    expectTypeOf<Executed<typeof query>>().toEqualTypeOf<
      { field: { label: string | null; form: { name: string } } | null }[]
    >()
  })

  test("applies the methods of a query of one row to a relation one", () => {
    const answers = tenant.answer.select(answer => ({
      taken: answer.field.select("id").take(),
      optional: answer.field.select("id").optional(),
      required: answer.field.select("id").required(),
      id: answer.field.get("id"),
      plucked: answer.field.pluck("id"),
    }))
    const fields = tenant.field.select(field => ({
      form: field.form.select("id").nullable(),
      name: field.form.get("name"),
    }))

    expectTypeOf<Executed<typeof answers>>().toEqualTypeOf<
      {
        taken: { id: string } | null
        optional: { id: string } | undefined
        required: { id: string }
        id: string | undefined
        plucked: string | undefined
      }[]
    >()
    expectTypeOf<Executed<typeof fields>>().toEqualTypeOf<
      { form: { id: string } | null; name: string }[]
    >()
    tenant.answer.select(answer => ({
      // @ts-expect-error A relation one has no pagination.
      field: answer.field.limit(1),
    }))
    tenant.answer.select(answer => ({
      // @ts-expect-error A relation one has no pagination.
      field: answer.field.offset(1),
    }))
  })

  test("gives one record or value after take, and null or undefined without it after nullable or optional", () => {
    const query = forms.form.select(form => ({
      first: form.fields.select("label").take(),
      firstNullable: form.fields.select("label").take().nullable(),
      firstOptional: form.fields.select("label").take().optional(),
      labels: form.fields.pluck("label"),
      label: form.fields.get("label").optional(),
    }))

    expectTypeOf<Executed<typeof query>>().toEqualTypeOf<
      {
        first: { label: string | null }
        firstNullable: { label: string | null } | null
        firstOptional: { label: string | null } | undefined
        labels: (string | null)[]
        label: string | null | undefined
      }[]
    >()
  })

  test("finds a related record by its key, or a record by a column of the parent row", () => {
    const fields = forms.form.select(form => ({
      field: form.fields.find("field-id").select("label"),
      label: form.fields.findBy({ id: "field-id" }).get("label").optional(),
    }))
    const answers = tenant.answer.select(answer => ({
      field: forms.field.find(answer.fieldId).select("label").optional(),
    }))

    expectTypeOf<Executed<typeof fields>>().toEqualTypeOf<
      { field: { label: string | null }; label: string | null | undefined }[]
    >()
    expectTypeOf<Executed<typeof answers>>().toEqualTypeOf<
      { field: { label: string | null } | undefined }[]
    >()
  })

  test("gives null or undefined without the record of a required relation that a filter excludes, unless required is called before or after the filter", () => {
    const fields = tenant.field.select(field => ({
      filtered: field.form.where({ name: "Survey" }).select("name"),
      found: field.form.find("form-id").select("name"),
      foundBy: field.form.findBy({ id: "form-id" }).select("name"),
      nameAfterFilter: field.form.where({ name: "Survey" }).get("name"),
      nameBeforeFilter: field.form.get("name").where({ name: "Survey" }),
      namesAfterFilter: field.form.where({ name: "Survey" }).pluck("name"),
      namesBeforeFilter: field.form.pluck("name").where({ name: "Survey" }),
      required: field.form.where({ name: "Survey" }).select("name").required(),
      requiredBeforeFilter: field.form.select("name").required().where({ name: "Survey" }),
    }))
    const answers = tenant.answer.select(answer => ({
      field: answer.field.where({ label: "Email" }).select("id"),
    }))
    const firstFields = forms.form.select(form => ({
      firstField: form.fields.take().where({ label: "Email" }).select("id"),
    }))

    expectTypeOf<Executed<typeof fields>>().toEqualTypeOf<
      {
        filtered: { name: string } | null
        found: { name: string } | null
        foundBy: { name: string } | null
        nameAfterFilter: string | undefined
        nameBeforeFilter: string | undefined
        namesAfterFilter: string | undefined
        namesBeforeFilter: string | undefined
        required: { name: string }
        requiredBeforeFilter: { name: string }
      }[]
    >()
    expectTypeOf<Executed<typeof answers>>().toEqualTypeOf<{ field: { id: string } | null }[]>()
    expectTypeOf<Executed<typeof firstFields>>().toEqualTypeOf<{ firstField: { id: string } }[]>()
  })

  test("gives null or undefined without the record of a required relation that a condition of its group excludes, unless required is called after it", () => {
    const groups = tenant.field.select(field => ({
      filtered: field.form
        .groupBy("id")
        .having(() => count().gt(1))
        .select("name"),
      nameAfterFilter: field.form
        .groupBy("id")
        .having(() => count().gt(1))
        .get("name"),
      nameBeforeFilter: field.form
        .get("name")
        .groupBy("id")
        .having(() => count().gt(1)),
      required: field.form
        .groupBy("id")
        .having(() => count().gt(1))
        .select("name")
        .required(),
      kept: field.form.groupBy("id").select("name"),
    }))

    expectTypeOf<Executed<typeof groups>>().toEqualTypeOf<
      {
        filtered: { name: string } | null
        nameAfterFilter: string | undefined
        nameBeforeFilter: string | undefined
        required: { name: string }
        kept: { name: string }
      }[]
    >()
  })

  test("gives the number of related records, also of a relation one filtered before or after count", () => {
    const counted = tenant.field.select(field => ({
      answerCount: field.answers.where({ value: "Yes" }).count(),
      formCount: field.form.count(),
      filteredFormCount: field.form.where({ name: "Survey" }).count(),
      formCountFiltered: field.form.count().where({ name: "Survey" }),
      formCountFound: field.form.count().find("form-id"),
      formCountFoundBy: field.form.count().findBy({ id: "form-id" }),
    }))

    expectTypeOf<Executed<typeof counted>>().toEqualTypeOf<
      {
        answerCount: number
        formCount: number
        filteredFormCount: number
        formCountFiltered: number
        formCountFound: number
        formCountFoundBy: number
      }[]
    >()
  })

  test("gives an aggregate of related records, or null without them unless a fallback of the parent row replaces it", () => {
    const aggregated = tenant.form.select(form => ({
      lastLabel: form.fields.max(field => field.label),
      colorLabels: form.fields.where({ label: "Color" }).stringAgg("label", ", "),
      lastLabelOrName: form.fields.max("label").coalesce(form.name),
    }))

    expectTypeOf<Executed<typeof aggregated>>().toEqualTypeOf<
      { lastLabel: string | null; colorLabels: string | null; lastLabelOrName: string }[]
    >()
  })

  test("gives whether related records exist, also of a relation one", () => {
    const checked = tenant.field.select(field => ({
      hasYes: field.answers.where({ value: "Yes" }).exists(),
      hasForm: field.form.exists(),
      unanswered: not(field.answers.exists()),
    }))

    expectTypeOf<Executed<typeof checked>>().toEqualTypeOf<
      { hasYes: boolean; hasForm: boolean; unanswered: boolean }[]
    >()
  })

  test("gives a condition of get of a related record, or null without a record that the relation does not guarantee", () => {
    const checked = tenant.field.select(field => ({
      notOfSurvey: not(field.form.get(form => form.name.eq("Survey"))),
      ofSurvey: not(field.form.where({ name: "Survey" }).get(form => form.id.isNull())),
    }))

    expectTypeOf<Executed<typeof checked>>().toEqualTypeOf<
      { notOfSurvey: boolean; ofSurvey: boolean | null }[]
    >()
  })

  test("gives undefined without the record of a required relation that a filter excludes for a value of type never", () => {
    const failing = t.text.transform({
      decode: (): never => {
        throw new Error("Not decodable")
      },
    })
    const fields = tenant.field.select(field => ({
      afterFilter: field.form.where({ name: "Survey" }).get(() => sql(failing)`'x'`),
      beforeFilter: field.form.get(() => sql(failing)`'x'`).where({ name: "Survey" }),
    }))

    expectTypeOf<Executed<typeof fields>>().toEqualTypeOf<
      { afterFilter: undefined; beforeFilter: undefined }[]
    >()
  })

  test("gives undefined without the record of a required relation that a filter excludes for a query of any result", () => {
    const fields = tenant.field.select(field => {
      const form: SelectQuery<AnyResult<typeof field.form.types>> = field.form
      return {
        name: form.where({ name: "Survey" }).get("name"),
      }
    })

    expectTypeOf<Executed<typeof fields>>().toEqualTypeOf<{ name: string | undefined }[]>()
  })

  test("rejects a filter of a union of queries of a required relation", () => {
    tenant.field.select(field => ({
      // @ts-expect-error A filter changes the state of a query of a required relation, so a union of such queries does not take it.
      form: field.form
        .use(form => (flag ? form.select("id") : form.select("name")))
        .where({ name: "Survey" }),
    }))
  })

  test("gives the value of either branch of a field of a query or an expression", () => {
    const pick = (labels: boolean) =>
      forms.form.select(form => ({
        value: labels ? form.fields.pluck("label") : form.name,
      }))

    expectTypeOf<Executed<ReturnType<typeof pick>>>().toEqualTypeOf<
      { value: (string | null)[] | string }[]
    >()
  })

  test("selects the columns and the relations of spread references", () => {
    const spreadForms = forms.form.select(form => ({ ...form }))
    const spreadFields = forms.field.select(field => ({ ...field }))

    expectTypeOf<Executed<typeof spreadForms>>().toEqualTypeOf<
      { id: string; name: string; fields: EmptyRecord[] }[]
    >()
    expectTypeOf<Executed<typeof spreadFields>>().toEqualTypeOf<
      { id: string; formId: string; label: string | null; form: EmptyRecord }[]
    >()
  })

  test("gives the relations of the target table in the schema of the query", () => {
    const query = tenant.form.select(form => ({
      fields: form.fields.select(field => ({
        answers: field.answers.pluck("value"),
      })),
    }))

    expectTypeOf<Executed<typeof query>>().toEqualTypeOf<{ fields: { answers: string[] }[] }[]>()

    forms.form.select(form => ({
      fields: form.fields.select(field => ({
        // @ts-expect-error The forms schema has no answers.
        answers: field.answers,
      })),
    }))
  })

  test("gives an unbound query of a relation to a query of a Db", async () => {
    const forms = await tenantDb.form.select(form => ({
      fields: form.fields.select("id"),
    }))

    expectTypeOf(forms).toEqualTypeOf<{ fields: { id: string }[] }[]>()
  })

  test("gives no relations to a query of from", () => {
    from(form).select(form => ({
      // @ts-expect-error A query of from has no relations.
      fields: form.fields,
    }))
  })

  test("accepts a query of either kind, and rejects a Promise", () => {
    const query = tenantDb.form.select(form => ({
      labels: forms.field.where(field => field.formId.eq(form.id)).pluck("label"),
      answers: tenantDb.answer.pluck("value").take().optional(),
    }))

    expectTypeOf<Executed<typeof query>>().toEqualTypeOf<
      { labels: (string | null)[]; answers: string | undefined }[]
    >()
    // The callback returns a `Selection`, so that the error is reported at the field rather than at the call.
    tenantDb.form.select((): Selection => ({
      // @ts-expect-error A Promise is not a query.
      fields: Promise.resolve([]),
    }))
  })

  test("rejects an object that is not a query, such as a copy of a query", () => {
    // The callbacks return a `Selection`, so that the errors are reported at the fields rather than at the calls.
    forms.form.select((form): Selection => ({
      // @ts-expect-error Only a query nests its rows.
      fields: { types: form.fields.types },
    }))
    forms.form.select((form): Selection => ({
      // @ts-expect-error A copy of a query is not a query.
      fields: { ...form.fields },
    }))
  })
})

describe("where", () => {
  test("filters by queries of the relations of the table at any depth", () => {
    const answered = tenant.form.where(form =>
      form.fields.where(field => field.answers.exists()).exists(),
    )
    const query = tenant.field.select(field => ({
      emptyForm: field.form.where(form => not(form.fields.exists())).select("name"),
    }))

    expectTypeOf<Executed<typeof answered>>().toEqualTypeOf<EmptyRecord[]>()
    expectTypeOf<Executed<typeof query>>().toEqualTypeOf<{ emptyForm: { name: string } | null }[]>()
  })

  test("keeps the relations of a condition out of the state, which a Db checks when it runs the query", () => {
    const query = tenant.form.where(form => form.fields.exists())

    expectTypeOf<(typeof query)["types"]["uses"]>().toBeNever()
  })

  test("gives no relations to a query of from", () => {
    // @ts-expect-error A query of from has no relations.
    from(form).where(form => form.fields.exists())
  })
})

describe("orderBy", () => {
  test("sorts by queries of one value of the relations of the table, also of a query of values", () => {
    const query = tenant.form
      .orderBy(form => [desc(form.fields.count()), form.fields.exists()])
      .select("id")
    const labels = tenant.field.pluck("label").orderBy(field => asc(field.form.get("name")))

    expectTypeOf<Executed<typeof query>>().toEqualTypeOf<{ id: string }[]>()
    expectTypeOf<Executed<typeof labels>>().toEqualTypeOf<(string | null)[]>()
  })

  test("rejects a query of the records or the values of a relation many", () => {
    // @ts-expect-error A sort key is a query of one value, not of an array.
    tenant.form.orderBy(form => form.fields.pluck("id"))
    // @ts-expect-error A sort key is a query of one value, not of records.
    tenant.form.orderBy(form => desc(form.fields.select("id")))
  })

  test("gives no relations to a query of from", () => {
    // @ts-expect-error A query of from has no relations.
    from(form).orderBy(form => form.fields.count())
  })
})

describe("callbacks of values", () => {
  test("give the value of a query of one value, NULL without its row unless it always has it", () => {
    const counts = tenant.form.pluck(form => form.fields.count())
    const filled = tenant.form.pluck(form => form.fields.exists())
    const name = tenant.field.take().get(field => field.form.get("name"))
    const label = tenant.form.take().get(form => form.fields.get("label"))
    const optional = tenant.form
      .take()
      .optional()
      .get(form => form.fields.get("id"))

    expectTypeOf<Executed<typeof counts>>().toEqualTypeOf<number[]>()
    expectTypeOf<Executed<typeof filled>>().toEqualTypeOf<boolean[]>()
    expectTypeOf<Executed<typeof name>>().toEqualTypeOf<string>()
    expectTypeOf<Executed<typeof label>>().toEqualTypeOf<string | null>()
    expectTypeOf<Executed<typeof optional>>().toEqualTypeOf<string | null | undefined>()
  })

  test("aggregate the values of a query of one value", () => {
    const max = tenant.form.max(form => form.fields.count())
    const every = tenant.field.every(field => field.answers.exists())
    const count = tenant.form.count(form => form.fields.get("id"))
    const distinct = tenant.form.countDistinct(form => form.fields.get("id"))
    const joined = tenant.field.stringAgg(field => field.form.get("name"), ",")

    expectTypeOf<Executed<typeof max>>().toEqualTypeOf<number | null>()
    expectTypeOf<Executed<typeof every>>().toEqualTypeOf<boolean | null>()
    expectTypeOf<Executed<typeof count>>().toEqualTypeOf<number>()
    expectTypeOf<Executed<typeof distinct>>().toEqualTypeOf<number>()
    expectTypeOf<Executed<typeof joined>>().toEqualTypeOf<string | null>()
  })

  test("keep the type of the value of a query, which gives the operators and encodes a fallback", () => {
    const greater = tenant.form.where(form =>
      form.fields
        .max(field => field.answers.count())
        .expr()
        .gt(3),
    )
    const fallback = tenant.form.pluck(form => form.fields.max("label")).coalesce("None")
    const sorted = tenant.form
      .pluck(form => form.fields.count())
      .orderBy((_form, value) => desc(value))

    expectTypeOf<Executed<typeof greater>>().toEqualTypeOf<EmptyRecord[]>()
    expectTypeOf<Executed<typeof fallback>>().toEqualTypeOf<string[]>()
    expectTypeOf<Executed<typeof sorted>>().toEqualTypeOf<number[]>()
  })

  test("reject a query of the records or the values of a relation many", () => {
    // @ts-expect-error The value is a query of one value, not of an array.
    tenant.form.pluck(form => form.fields.pluck("id"))
    // @ts-expect-error The value is a query of one value, not of records.
    tenant.form.take().get(form => form.fields.select("id"))
    // @ts-expect-error The value is a query of one value, not of records.
    tenant.form.max(form => form.fields)
  })

  test("add the relations of a query to the state, which a Db must have, unlike those of an expression", () => {
    const query = tenant.field.pluck(field => field.answers.count())
    const aggregate = tenant.field.max(field => field.answers.count())
    const counted = tenant.field.count(field => field.answers.get("id"))
    const expression = tenant.field.pluck(field => field.answers.count().expr())
    const shared = createDatabase({ driver: createRecordingDriver().driver }).bind(forms)

    expectTypeOf<(typeof expression)["types"]["uses"]>().toBeNever()
    // @ts-expect-error The schema of the Db lacks the relation.
    shared.$compile(query)
    // @ts-expect-error The schema of the Db lacks the relation.
    shared.$compile(aggregate)
    // @ts-expect-error The schema of the Db lacks the relation.
    shared.$compile(counted)
    shared.$compile(forms.form.pluck(form => form.fields.count()))
  })

  test("give no relations to a query of from", () => {
    // @ts-expect-error A query of from has no relations.
    from(form).pluck(form => form.fields.count())
    // @ts-expect-error A query of from has no relations.
    from(form).max(form => form.fields.count())
  })
})
