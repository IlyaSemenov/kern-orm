import { describe, expectTypeOf, test } from "bun:test"

import type { ResultOf } from "kern-orm"
import { createDatabase, defineSchema, defineTable } from "kern-orm"
import * as t from "kern-orm/types"

import {
  deleteFormsWithFields,
  hasFieldId,
  insertForm,
  namesWithFields,
  renameForm,
  schema,
  selectName,
  selectNameAsTitle,
  selectNames,
  selectNameWithHelper,
  upsertForm,
  withFieldIds,
} from "../declarations/helper.js"

describe("emitted query declarations", () => {
  test("preserves the input fields and selects a column through a generic function", () => {
    const query = selectName(schema.form.select("id"))

    expectTypeOf<ResultOf<typeof query>>().toEqualTypeOf<{ id: string; name: string }>()
  })

  test("preserves the input fields and selects an expression through a generic function", () => {
    const query = selectNameAsTitle(schema.form.select("id"))

    expectTypeOf<ResultOf<typeof query>>().toEqualTypeOf<{ id: string; title: string }>()
  })

  test("preserves the input fields and selects a column with a helper through a generic function", () => {
    const query = selectNameWithHelper(schema.form.select("id"), "form-id")

    expectTypeOf<ResultOf<typeof query>>().toEqualTypeOf<{ id: string; name: string }>()
  })
})

describe("emitted schema declarations", () => {
  test("let a Db of a schema that includes the schema serve its shared code", () => {
    const user = defineTable("user", {
      id: t.uuid,
    })
    const database = createDatabase({
      driver: {
        execute: () => Promise.reject(new Error("unused")),
        executeScript: () => Promise.reject(new Error("unused")),
        acquire: () => Promise.reject(new Error("unused")),
        close: () => Promise.resolve(),
      },
    })

    const query = selectNames(database.bind(defineSchema(schema, { user })))
    expectTypeOf<ResultOf<typeof query>>().toEqualTypeOf<string>()
    // @ts-expect-error The schema lacks the relations of the shared schema.
    selectNames(database.bind(defineSchema(schema.$tables)))
  })
})

describe("emitted declarations of queries of SQL text", () => {
  test("keep the records that they select and their rows mode", async () => {
    const database = createDatabase({
      driver: {
        execute: () => Promise.reject(new Error("unused")),
        executeScript: () => Promise.reject(new Error("unused")),
        acquire: () => Promise.reject(new Error("unused")),
        close: () => Promise.resolve(),
      },
    })

    expectTypeOf(await upsertForm(database.bind(schema), "Survey")).toEqualTypeOf<
      { id: string; name: string } | undefined
    >()
  })
})

describe("emitted expression declarations", () => {
  test("filter by and select an expression of a relation", () => {
    const query = schema.form
      .where(form => hasFieldId(form, "field-id"))
      .select(form => ({
        hasField: hasFieldId(form, "field-id"),
      }))

    expectTypeOf<ResultOf<typeof query>>().toEqualTypeOf<{ hasField: boolean }>()
  })
})

describe("emitted relation declarations", () => {
  test("select the records of relations, which only a Db of the relations executes", () => {
    const database = createDatabase({
      driver: {
        execute: () => Promise.reject(new Error("unused")),
        executeScript: () => Promise.reject(new Error("unused")),
        acquire: () => Promise.reject(new Error("unused")),
        close: () => Promise.resolve(),
      },
    })
    const query = schema.form.select("id").use(withFieldIds)

    expectTypeOf<ResultOf<typeof query>>().toEqualTypeOf<{ id: string; fields: string[] }>()
    expectTypeOf(database.bind(schema).$execute(namesWithFields)).toEqualTypeOf<
      Promise<{ name: string; fields: { id: string }[] }[]>
    >()
    // @ts-expect-error The schema lacks the relations of the shared schema.
    void database.bind(defineSchema(schema.$tables)).$execute(namesWithFields)
  })
})

describe("emitted declarations of queries that change rows", () => {
  test("return the selected fields of the changed rows, which only a Db of the relations executes", () => {
    const database = createDatabase({
      driver: {
        execute: () => Promise.reject(new Error("unused")),
        executeScript: () => Promise.reject(new Error("unused")),
        acquire: () => Promise.reject(new Error("unused")),
        close: () => Promise.resolve(),
      },
    })
    const db = database.bind(schema)

    expectTypeOf(db.$execute(renameForm("form-id", "Survey"))).toEqualTypeOf<
      Promise<{ id: string; name: string }>
    >()
    expectTypeOf(db.$execute(insertForm("Survey"))).toEqualTypeOf<Promise<string>>()
    expectTypeOf(db.$execute(deleteFormsWithFields)).toEqualTypeOf<
      Promise<{ fields: string[] }[]>
    >()
    // @ts-expect-error The schema lacks the relations of the shared schema.
    void database.bind(defineSchema(schema.$tables)).$execute(deleteFormsWithFields)
  })
})
