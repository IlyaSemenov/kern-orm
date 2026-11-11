import { describe, expect, test } from "bun:test"

import { caseWhen } from "../expression/functions"
import { and, not, or } from "../expression/predicates"
import { param } from "../expression/sql"
import { many, one } from "../schema/relation"
import { defineSchema } from "../schema/schema"
import { defineTable } from "../table/table"
import * as t from "../types"

import { matches } from "./matches"
import { desc } from "./order"
import { from } from "./select"

const form = defineTable("form", {
  id: t.uuid.primaryKey(),
  name: t.text,
  published: t.boolean,
  hint: t.text.nullable(),
  settings: t.json.nullable(),
})

const field = defineTable("field", {
  id: t.uuid.primaryKey(),
  formId: t.uuid,
  name: t.text,
})

const schema = defineSchema({ form, field }).$relations({
  form: {
    fields: many(field, { from: "id", to: "formId" }),
  },
  field: {
    form: one(form, { from: "formId", to: "id", required: true }),
  },
})

describe("conditions", () => {
  test("match every value by the eq of its column", () => {
    expect(
      from(form)
        .where(form => matches(form, { name: "Survey", published: true }))
        .select("id")
        .toSQL(),
    ).toEqual(
      from(form)
        .where(form => and(form.name.eq("Survey"), form.published.eq(true)))
        .select("id")
        .toSQL(),
    )
  })

  test("match null by IS NULL", () => {
    expect(
      from(form)
        .where(form => matches(form, { hint: null }))
        .select("id")
        .toSQL(),
    ).toEqual(
      from(form)
        .where(form => form.hint.isNull())
        .select("id")
        .toSQL(),
    )
  })

  test("are TRUE of an empty object", () => {
    expect(
      from(form)
        .select(form => ({
          all: matches(form, {}),
        }))
        .toSQL(),
    ).toEqual(
      from(form)
        .select(() => ({
          all: and(),
        }))
        .toSQL(),
    )
  })

  test("take an expression or a query as a value", () => {
    const named = schema.form.take().get("name")

    expect(
      schema.field
        .where(field => matches(field, { formId: field.id, name: named }))
        .select("id")
        .toSQL(),
    ).toEqual(
      schema.field
        .where(field => and(field.formId.eq(field.id), field.name.eq(named)))
        .select("id")
        .toSQL(),
    )
  })

  test("match the column of a reference under another key", () => {
    expect(
      from(form)
        .where(form => matches({ alias: form.name }, { alias: "Survey" }))
        .select("id")
        .toSQL(),
    ).toEqual(
      from(form)
        .where(form => form.name.eq("Survey"))
        .select("id")
        .toSQL(),
    )
  })

  test("call a custom eq, as an object of where does", () => {
    const custom = defineTable("custom", {
      value: t.text.withOperators({
        eq: () => param(t.boolean, true),
      }),
    })

    expect(
      from(custom)
        .where(custom => matches(custom, { value: "x" }))
        .select("value")
        .toSQL(),
    ).toEqual(from(custom).where({ value: "x" }).select("value").toSQL())
  })
})

describe("uses", () => {
  test("apply wherever an expression does", () => {
    const query = from(form)
      .orderBy(form => desc(matches(form, { published: true })))
      .select(form => ({
        isSurvey: matches(form, { name: "Survey" }),
        label: caseWhen(t.text, [[matches(form, { published: true }), "yes"]], "no"),
        either: or(matches(form, { name: "Survey" }), not(matches(form, { published: true }))),
      }))

    expect(query.toSQL()).toEqual(
      from(form)
        .orderBy(form => desc(form.published.eq(true)))
        .select(form => ({
          isSurvey: form.name.eq("Survey"),
          label: caseWhen(t.text, [[form.published.eq(true), "yes"]], "no"),
          either: or(form.name.eq("Survey"), not(form.published.eq(true))),
        }))
        .toSQL(),
    )
  })

  test("refer to the columns they receive, not to the table of the enclosing where", () => {
    // Both tables have `name`, which an object of `or` would resolve against the table of the fields.
    const query = schema.form
      .where(form => form.fields.where(() => matches(form, { name: "Survey" })).exists())
      .select("id")

    expect(query.toSQL()).toEqual(
      schema.form
        .where(form => form.fields.where(() => form.name.eq("Survey")).exists())
        .select("id")
        .toSQL(),
    )
  })
})

describe("rejected values", () => {
  test.each([
    ["false", false],
    ["an array", []],
    ["a date", new Date()],
    [
      "an instance whose values are getters",
      new (class {
        get name() {
          return "Survey"
        }
      })(),
    ],
  ])("%s, which an object of where rejects too", (_name, values) => {
    expect(() => from(form).where(form => matches(form, values as never))).toThrow(
      "The values of matches must be an object of column values",
    )
  })

  test("a key that is not among the references", () => {
    expect(() => from(form).where(form => matches(form, { nmae: "Survey" } as never))).toThrow(
      'The references of matches have no column "nmae"',
    )
  })

  test("a relation", () => {
    expect(() => schema.form.where(form => matches(form, { fields: true } as never))).toThrow(
      'The references of matches have no column "fields"',
    )
  })

  test("a column without an eq operator, as an object of where does", () => {
    expect(() =>
      from(form).where(form => matches(form, { settings: { theme: "dark" } } as never)),
    ).toThrow('Column "settings" of table "form" has no eq operator')
  })
})
