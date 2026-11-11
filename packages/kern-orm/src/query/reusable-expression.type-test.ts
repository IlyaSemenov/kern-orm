import { describe, expectTypeOf, test } from "bun:test"

import { createRecordingDriver } from "../../testing/database/recording-driver"
import { createDatabase } from "../execution/database"
import type { Expression } from "../expression/expression"
import { caseWhen, coalesce } from "../expression/functions"
import { and, not, or } from "../expression/predicates"
import { many, one } from "../schema/relation"
import { defineSchema } from "../schema/schema"
import { defineTable } from "../table/table"
import * as t from "../types"

import { matches } from "./matches"
import { desc } from "./order"
import { defineExpression } from "./reusable-expression"
import type { ResultOf } from "./select"
import { from } from "./select"

const form = defineTable("form", {
  id: t.uuid.primaryKey(),
  name: t.text,
  published: t.boolean,
  hint: t.text.nullable(),
})

const field = defineTable("field", {
  id: t.uuid.primaryKey(),
  formId: t.uuid,
  label: t.text,
})

const answer = defineTable("answer", {
  id: t.uuid.primaryKey(),
  fieldId: t.uuid,
})

const schema = defineSchema({ form, field }).$relations({
  form: {
    fields: many(field, { from: "id", to: "formId" }),
  },
  field: {
    form: one(form, { from: "formId", to: "id", required: true }),
  },
})

const tenant = defineSchema(schema, { answer }).$relations({
  field: {
    answers: many(answer, { from: "id", to: "fieldId" }),
  },
})

const { driver } = createRecordingDriver()
const db = createDatabase({ driver }).bind(schema)
const tenantDb = createDatabase({ driver }).bind(tenant)

const hasField = defineExpression(db.form, (form, label: string) =>
  form.fields.where({ label }).exists(),
)

describe("result", () => {
  test("a query of one value is selected with its value", () => {
    const query = db.form.select(form => ({
      hasField: hasField(form, "Email"),
    }))

    expectTypeOf<ResultOf<typeof query>>().toEqualTypeOf<{ hasField: boolean }>()
  })

  test("an expression keeps its values and its operators", () => {
    const fieldCount = defineExpression(db.form, form => form.fields.count().expr())
    const query = db.form
      .where(form => fieldCount(form).gt(3))
      .select(form => ({
        fieldCount: fieldCount(form),
      }))

    expectTypeOf<ResultOf<typeof query>>().toEqualTypeOf<{ fieldCount: number }>()
  })

  test("a Boolean expression tells whether it can be NULL", () => {
    const isPublished = defineExpression(db.form, form => form.published.eq(true))
    const hasHint = defineExpression(db.form, (form, hint: string) => form.hint.eq(hint))
    const query = db.form.select(form => ({
      isPublished: isPublished(form),
      hasHint: hasHint(form, "Optional"),
      either: or(isPublished(form), hasField(form, "Email")),
    }))

    expectTypeOf<ResultOf<typeof query>>().toEqualTypeOf<{
      isPublished: boolean
      hasHint: boolean | null
      either: boolean
    }>()
  })

  test("a callback returns an expression or a query of one value", () => {
    // @ts-expect-error An object of column values is not an expression.
    defineExpression(db.form, () => ({ published: true }))

    // @ts-expect-error A plain Boolean value is not an expression.
    defineExpression(db.form, () => true)

    // @ts-expect-error A plain number is not an expression.
    defineExpression(db.form, () => 42)

    // @ts-expect-error A query of records is not a query of one value.
    defineExpression(db.form, form => form.fields)
  })

  test("objects of column values apply to where, not to and, or, and not", () => {
    defineExpression(db.form, form => form.fields.where({ label: "Email" }).exists())

    // @ts-expect-error `or` of an expression has no table for its objects.
    defineExpression(db.form, form => or({ published: true }, form.fields.exists()))
  })
})

describe("arguments", () => {
  test("are required, typed, and optional as the callback declares them", () => {
    const named = defineExpression(db.form, (form, name?: string) => form.name.eq(name ?? "Survey"))
    db.form.where(form => and(named(form), named(form, "Poll")))

    // @ts-expect-error The argument is required.
    db.form.where(form => hasField(form))

    // @ts-expect-error The argument is a string.
    db.form.where(form => hasField(form, 42))
  })

  test("need a type in the callback", () => {
    // @ts-expect-error The parameter is `unknown` without a type.
    defineExpression(db.form, (form, name) => form.name.eq(name))
  })

  test("take a column of another query through an expression parameter", () => {
    const hasLabel = defineExpression(db.form, (form, label: string | Expression<string>) =>
      form.fields.where({ label }).exists(),
    )
    const query = db.field.select(field => ({
      formHasLabel: field.form.where(form => hasLabel(form, field.label)).exists(),
    }))

    expectTypeOf<ResultOf<typeof query>>().toEqualTypeOf<{ formHasLabel: boolean }>()
  })
})

describe("calls", () => {
  test("apply wherever a query takes an expression", () => {
    db.form.where(form => hasField(form, "Email"))
    db.form.where(form => not(hasField(form, "Email")))
    db.form.where(form => or(form.published.eq(true), hasField(form, "Email")))
    db.form.orderBy(form => desc(hasField(form, "Email")))

    const query = db.form.select(form => ({
      weight: caseWhen(t.integer, [[hasField(form, "Email"), 1]], 0),
      hasField: coalesce(hasField(form, "Email"), false),
    }))
    expectTypeOf<ResultOf<typeof query>>().toEqualTypeOf<{ weight: number; hasField: boolean }>()
  })

  test("apply directly to where without further arguments", () => {
    const hasFields = defineExpression(db.form, form => form.fields.exists())

    db.form.where(hasFields)
  })

  test("combine with other expressions and with objects of column values", () => {
    const isPublic = defineExpression(db.form, (form, label: string) =>
      and(form.published.eq(true), hasField(form, label)),
    )
    const isListed = defineExpression(db.form, form =>
      or(matches(form, { published: true }), hasField(form, "Email"), isPublic(form, "Name")),
    )

    db.form.where(isListed)
    db.form.where(form => or({ published: true }, isPublic(form, "Name")))
  })

  test("apply to the query of a relation", () => {
    const isLabeled = defineExpression(db.field, (field, label: string) => field.label.eq(label))
    const query = db.form.select(form => ({
      fields: form.fields.where(field => isLabeled(field, "Email")).pluck("id"),
    }))

    expectTypeOf<ResultOf<typeof query>>().toEqualTypeOf<{ fields: string[] }>()
  })
})

describe("source of the definition", () => {
  const isNamed = defineExpression(form, (form, name: string) => form.name.eq(name))

  test("a query of a schema or a Db gives the relations and applies to schemas that have them", () => {
    const ofSchema = defineExpression(schema.form, form => form.fields.exists())
    const ofTenant = defineExpression(tenantDb.field, field => field.answers.exists())

    db.form.where(ofSchema)
    schema.form.where(ofSchema)
    tenantDb.form.where(ofSchema)
    tenantDb.form.where(form => hasField(form, "Email"))
    tenantDb.field.where(ofTenant)

    // @ts-expect-error The schema of this Db lacks the relation that the expression reads.
    db.field.where(ofTenant)

    // @ts-expect-error A query of from has no relations.
    from(form).where(ofSchema)
  })

  test("a table gives only the columns and applies to every query of the table", () => {
    // @ts-expect-error A table has no relations.
    defineExpression(form, form => form.fields.exists())

    from(form).where(form => isNamed(form, "Survey"))
    db.form.where(form => isNamed(form, "Survey"))
    tenantDb.form.where(form => isNamed(form, "Survey"))
  })

  test("a query of a schema or a Db applies to the callbacks of values of queries whose schema has its relations", () => {
    const isNamedOfDb = defineExpression(db.form, (form, name: string) => form.name.eq(name))

    db.form.take().get(form => isNamedOfDb(form, "Survey"))
    db.form.pluck(form => isNamedOfDb(form, "Survey"))
    db.form.every(form => isNamedOfDb(form, "Survey"))
    db.form.find("id").update(form => ({
      published: isNamedOfDb(form, "Survey"),
    }))
    db.form
      .find("id")
      .delete()
      .get(form => isNamedOfDb(form, "Survey"))
    tenantDb.form.pluck(form => isNamedOfDb(form, "Survey"))

    const fromTable = from(form)
    const found = fromTable.find("id")

    // @ts-expect-error A query of from has no relations.
    found.get(form => isNamedOfDb(form, "Survey"))

    // @ts-expect-error A query of from has no relations.
    found.update(form => ({ published: isNamedOfDb(form, "Survey") }))
  })

  test("a table applies to the callbacks of values of every query of the table", () => {
    from(form)
      .take()
      .get(form => isNamed(form, "Survey"))
    db.form.pluck(form => isNamed(form, "Survey"))
    db.form.every(form => isNamed(form, "Survey"))
    db.form.find("id").update(form => ({
      published: isNamed(form, "Survey"),
    }))
  })

  test("a query that it returns applies to the callbacks of values with its value", () => {
    const firstLabel = defineExpression(db.form, form => form.fields.get("label"))
    const query = db.form.take().get(form => hasField(form, "Email"))
    const labels = db.form.pluck(firstLabel)
    const count = db.form.count(firstLabel)
    const every = db.form.every(form => hasField(form, "Email"))

    expectTypeOf<ResultOf<typeof query>>().toEqualTypeOf<boolean>()
    expectTypeOf<ResultOf<typeof labels>>().toEqualTypeOf<string | null>()
    expectTypeOf<ResultOf<typeof count>>().toEqualTypeOf<number>()
    expectTypeOf<ResultOf<typeof every>>().toEqualTypeOf<boolean | null>()

    db.form.find("id").update(form => ({
      published: hasField(form, "Email"),
    }))
    db.form.find("id").update(form => ({
      name: firstLabel(form),
    }))
    db.form.find("id").update(form => ({
      hint: firstLabel(form),
    }))
  })

  test("an expression applies only to queries of its table", () => {
    // @ts-expect-error An expression of a form does not apply to the columns of a field.
    db.field.where(field => hasField(field, "Email"))
  })
})
