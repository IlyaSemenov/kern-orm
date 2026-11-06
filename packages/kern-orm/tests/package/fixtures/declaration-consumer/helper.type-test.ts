import { describe, expectTypeOf, test } from "bun:test"

import type { ResultOf, TableKeys } from "kern-orm"
import { createDatabase, defineSchema, defineTable } from "kern-orm"
import * as t from "kern-orm/types"

import {
  convertedFormCount,
  defineSnakeCaseTable,
  deleteForm,
  deleteFormsWithFields,
  firstFormByName,
  hasFieldId,
  insertForm,
  insertFormWithFieldIds,
  insertFormWithLength,
  isNamed,
  namesWithFields,
  renameForm,
  schema,
  selectName,
  selectNameAsTitle,
  selectNames,
  selectNameWithHelper,
  snakeCaseField,
  upsertForm,
  withFieldIds,
  withNameLength,
} from "../declarations/helper.js"

declare const flag: boolean

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

describe("emitted declarations of a converted query", () => {
  test("keep its result and the relations it selects", () => {
    const database = createDatabase({
      driver: {
        execute: () => Promise.reject(new Error("unused")),
        executeScript: () => Promise.reject(new Error("unused")),
        acquire: () => Promise.reject(new Error("unused")),
        close: () => Promise.resolve(),
      },
    })

    expectTypeOf(database.bind(schema).$execute(convertedFormCount)).toEqualTypeOf<
      Promise<number>
    >()
    // @ts-expect-error The schema lacks the relations of the query.
    void database.bind(defineSchema(schema.$tables)).$execute(convertedFormCount)
  })

  test("keep what a helper of map gives on a query of a table and on a mutation, without its marker", () => {
    const db = createDatabase({
      driver: {
        execute: () => Promise.reject(new Error("unused")),
        executeScript: () => Promise.reject(new Error("unused")),
        acquire: () => Promise.reject(new Error("unused")),
        close: () => Promise.resolve(),
      },
    }).bind(schema)
    type View = { name: string; length: number }

    expectTypeOf(db.$execute(schema.form.use(withNameLength))).toEqualTypeOf<Promise<View[]>>()
    expectTypeOf(db.$execute(firstFormByName)).toEqualTypeOf<Promise<View>>()
    expectTypeOf(db.$execute(insertFormWithLength("name"))).toEqualTypeOf<Promise<View>>()
    expectTypeOf(db.$execute(deleteForm("id"))).toEqualTypeOf<Promise<boolean>>()
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

  test("select an expression of an object of column values", () => {
    const query = schema.form.select(form => ({
      isNamed: isNamed(form, "Survey"),
    }))

    expectTypeOf<ResultOf<typeof query>>().toEqualTypeOf<{ isNamed: boolean }>()
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

describe("emitted declarations of a table factory", () => {
  test("keep the type of defineTable", () => {
    expectTypeOf(defineSnakeCaseTable).toEqualTypeOf<typeof defineTable>()
  })

  test("define tables with and without options, keeping their keys", () => {
    const answer = defineSnakeCaseTable(
      "form_answer",
      {
        submissionId: t.uuid,
        fieldId: t.uuid,
      },
      { primaryKey: ["submissionId", "fieldId"] },
    )
    const log = defineSnakeCaseTable(
      "log",
      {
        id: t.uuid.primaryKey(),
        code: t.text,
      },
      flag ? { unique: [["id", "code"]] } : undefined,
    )

    expectTypeOf(snakeCaseField.keys).toEqualTypeOf<TableKeys<readonly ["id"], never>>()
    expectTypeOf(answer.keys).toEqualTypeOf<
      TableKeys<readonly ["submissionId", "fieldId"], never>
    >()
    expectTypeOf(log.keys).toEqualTypeOf<
      TableKeys<readonly ["id"], never> | TableKeys<readonly ["id"], readonly ["id", "code"]>
    >()
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
    expectTypeOf(db.$execute(insertFormWithFieldIds("Survey"))).toEqualTypeOf<
      Promise<{ fields: string[] }>
    >()
    // @ts-expect-error The schema lacks the relations of the helper.
    void database.bind(defineSchema(schema.$tables)).$execute(insertFormWithFieldIds("Survey"))
    expectTypeOf(db.$execute(deleteFormsWithFields)).toEqualTypeOf<
      Promise<{ fields: string[] }[]>
    >()
    // @ts-expect-error The schema lacks the relations of the shared schema.
    void database.bind(defineSchema(schema.$tables)).$execute(deleteFormsWithFields)
  })
})
