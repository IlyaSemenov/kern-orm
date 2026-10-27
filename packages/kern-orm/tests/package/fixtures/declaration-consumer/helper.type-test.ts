import { describe, expectTypeOf, test } from "bun:test"

import type { ResultOf } from "kern-orm"
import { createDatabase, defineSchema, defineTable } from "kern-orm"
import * as t from "kern-orm/types"

import {
  namesWithFields,
  schema,
  selectName,
  selectNameAsTitle,
  selectNames,
  selectNameWithHelper,
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

describe("emitted relation declarations", () => {
  test("select the records of relations, which only a Db of the relations executes", () => {
    const database = createDatabase({
      driver: {
        execute: () => Promise.reject(new Error("unused")),
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
