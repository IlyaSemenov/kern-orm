import { describe, expectTypeOf, test } from "bun:test"

import type { EmptyRecord, NoOperators, ResultOf, TableKeys, Type } from "kern-orm"
import { bindSchema, createDatabase, defineSchema, defineTable } from "kern-orm"
import * as t from "kern-orm/types"

import {
  aggregateValue,
  convertedFormCount,
  defineSnakeCaseTable,
  deleteForm,
  deleteFormsWithFields,
  findFormByName,
  firstFormByName,
  getLicenseToken,
  groupedTotals,
  groupNames,
  groupOptionalTotal,
  hasFieldId,
  insertForm,
  insertFormConflict,
  insertFormWithFieldIds,
  insertFormWithLength,
  isNamed,
  licenseQuery,
  licenseSchema,
  namesWithFields,
  pageOfForms,
  plainNumeric,
  renameForm,
  requireLicenseToken,
  schema,
  selectName,
  selectNameAsTitle,
  selectNames,
  selectNameWithHelper,
  snakeCaseField,
  totalValues,
  upsertForm,
  upsertLicense,
  withFieldIds,
  withNameLength,
} from "../declarations/helper.js"

declare const flag: boolean

describe("emitted query declarations", () => {
  test("preserves grouped aggregate values and helper effects across declarations", () => {
    expectTypeOf<ResultOf<typeof groupedTotals>>().toEqualTypeOf<{ total: number }>()
    const optional = groupOptionalTotal({})
    expectTypeOf<ResultOf<typeof optional>>().toEqualTypeOf<{ total?: number }>()
    const groupedValues = totalValues.groupBy("name")
    expectTypeOf<ResultOf<typeof groupedValues>>().toEqualTypeOf<number>()
    const withHelper = schema.form
      .select(() => ({
        total: aggregateValue,
      }))
      .use(groupNames)
    expectTypeOf<ResultOf<typeof withHelper>>().toEqualTypeOf<{ total: number }>()
  })

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

    expectTypeOf(bindSchema(schema, database).$execute(convertedFormCount)).toEqualTypeOf<
      Promise<number>
    >()
    // @ts-expect-error The schema lacks the relations of the query.
    void bindSchema(defineSchema(schema.$tables), database).$execute(convertedFormCount)
  })

  test("keep what a helper of map gives on a query of a table and on a mutation, without its marker", () => {
    const db = bindSchema(
      schema,
      createDatabase({
        driver: {
          execute: () => Promise.reject(new Error("unused")),
          executeScript: () => Promise.reject(new Error("unused")),
          acquire: () => Promise.reject(new Error("unused")),
          close: () => Promise.resolve(),
        },
      }),
    )
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

    const query = selectNames(bindSchema(defineSchema(schema, { user }), database))
    expectTypeOf<ResultOf<typeof query>>().toEqualTypeOf<string>()
    // @ts-expect-error The schema lacks the relations of the shared schema.
    selectNames(bindSchema(defineSchema(schema.$tables), database))
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

    expectTypeOf(await upsertForm(bindSchema(schema, database), "Survey")).toEqualTypeOf<
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
    expectTypeOf(bindSchema(schema, database).$execute(namesWithFields)).toEqualTypeOf<
      Promise<{ name: string; fields: { id: string }[] }[]>
    >()
    // @ts-expect-error The schema lacks the relations of the shared schema.
    void bindSchema(defineSchema(schema.$tables), database).$execute(namesWithFields)
  })
})

describe("emitted declarations of a type defined from another type", () => {
  test("keep its values and type parameters, without its operators", () => {
    expectTypeOf(plainNumeric).toEqualTypeOf<
      Type<string, string | number | bigint, NoOperators, [precision: number, scale?: number]>
    >()
    expectTypeOf(plainNumeric.with(10, 2)).toEqualTypeOf(plainNumeric)
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
    const db = bindSchema(schema, database)

    expectTypeOf(db.$execute(renameForm("form-id", "Survey"))).toEqualTypeOf<
      Promise<{ id: string; name: string }>
    >()
    expectTypeOf(db.$execute(insertForm("Survey"))).toEqualTypeOf<Promise<string>>()
    expectTypeOf(db.$execute(insertFormConflict("Survey").doNothing().get("id"))).toEqualTypeOf<
      Promise<string | undefined>
    >()
    expectTypeOf(db.$execute(insertFormConflict("Survey").merge("id").get("id"))).toEqualTypeOf<
      Promise<string>
    >()
    expectTypeOf(
      db.$execute(findFormByName("Survey").upsert({ id: "form-id" }).get("id")),
    ).toEqualTypeOf<Promise<string>>()
    // @ts-expect-error A column of the key of findBy.
    findFormByName("Survey").upsert({ id: "form-id", name: "Survey" })
    expectTypeOf(db.$execute(insertFormWithFieldIds("Survey"))).toEqualTypeOf<
      Promise<{ fields: string[] }>
    >()
    const plainDb = bindSchema(defineSchema(schema.$tables), database)
    // @ts-expect-error The schema lacks the relations of the helper.
    void plainDb.$execute(insertFormWithFieldIds("Survey"))
    expectTypeOf(db.$execute(deleteFormsWithFields)).toEqualTypeOf<
      Promise<{ fields: string[] }[]>
    >()
    // @ts-expect-error The schema lacks the relations of the shared schema.
    void plainDb.$execute(deleteFormsWithFields)
  })
})

describe("emitted declarations of a singleton table", () => {
  test("start a query of its row, which upsert inserts or updates", () => {
    const database = createDatabase({
      driver: {
        execute: () => Promise.reject(new Error("unused")),
        executeScript: () => Promise.reject(new Error("unused")),
        acquire: () => Promise.reject(new Error("unused")),
        close: () => Promise.resolve(),
      },
    })
    const db = bindSchema(licenseSchema, database)

    expectTypeOf(db.$execute(licenseQuery)).toEqualTypeOf<Promise<EmptyRecord | undefined>>()
    expectTypeOf(db.$execute(upsertLicense("token"))).toEqualTypeOf<Promise<string>>()
    expectTypeOf(getLicenseToken(db)).resolves.toEqualTypeOf<string | undefined>()
    expectTypeOf(db.$execute(requireLicenseToken(licenseSchema.$tables.license))).toEqualTypeOf<
      Promise<string>
    >()
    expectTypeOf(
      bindSchema(schema, database).$execute(pageOfForms(schema.$tables.form)),
    ).toEqualTypeOf<Promise<{ name: string }[]>>()
    expectTypeOf(db.license.update({ token: "token" }).get("id")).resolves.toEqualTypeOf<
      string | undefined
    >()
    // @ts-expect-error A singleton table holds one row.
    licenseQuery.insertMany([{ token: "token" }])
    // @ts-expect-error A column of another table.
    licenseQuery.upsert({ token: "token", name: "Survey" })
    // @ts-expect-error A query of one row.
    licenseQuery.all()
  })
})
