import { describe, expectTypeOf, test } from "bun:test"

import { param, sql } from "../expression/sql"
import { from } from "../query/select"
import type { InsertValues } from "../query/values"
import type { Selectable } from "../table/table"
import { defineTable } from "../table/table"
import * as t from "../types"

import type { TypeInput, TypeOutput } from "./type"

describe("transform", () => {
  const price = defineTable("price", {
    amount: t.numeric.with(10, 2).transform({ decode: Number }),
    discount: t.numeric.with(10, 2).nullable().transform({ decode: Number }),
    at: t.timestamptz.transform({ decode: value => new Date(value) }),
  })

  test("changes the values of selected rows", () => {
    const row: Selectable<typeof price> = { amount: 12.5, discount: null, at: new Date() }
    void row

    // @ts-expect-error A transformed column has the new representation.
    const amount: Selectable<typeof price>["amount"] = "12.50"
    void amount
  })

  test("keeps the operators of the original type", () => {
    from(price).where(columns => columns.amount.lt(10))
    from(price).where(columns => columns.at.gt(new Date()))
  })

  test("passes non-null values to `decode`", () => {
    // @ts-expect-error `decode` receives non-null values of the column type.
    t.text.nullable().transform({ decode: (value: number) => value })
  })

  test("passes undefined that an earlier decoder returns to `decode`", () => {
    const optional = t.text.nullable().transform({
      decode: value => (value === "" ? undefined : value),
    })
    expectTypeOf(optional.decode("")).toEqualTypeOf<string | undefined>()

    optional.transform({ decode: value => value?.toUpperCase() ?? "" })
    // @ts-expect-error `decode` can receive undefined from an earlier decoder.
    optional.transform({ decode: value => value.toUpperCase() })
    optional.transform({ decode: value => value ?? "", encode: (value: string) => value })
    // @ts-expect-error `decode` can receive undefined from an earlier decoder, also with `encode`.
    optional.transform({ decode: value => value.toUpperCase(), encode: (value: string) => value })
  })

  test("decodes to values other than null, which stands for NULL", () => {
    // @ts-expect-error `decode` cannot return null.
    t.text.transform({ decode: value => (value === "missing" ? null : value) })
    // @ts-expect-error `decode` cannot return null, also with `encode`.
    t.text.transform({ decode: (): string | null => null, encode: (value: string) => value })
    t.text.transform({ decode: value => (value === "missing" ? undefined : value) })
  })

  test("keeps the nullability of the original type, also of values that include null", () => {
    class Wrapper {
      constructor(readonly value: unknown) {}
    }
    const wrapped = t.jsonb.transform({
      decode: value => new Wrapper(value),
      encode: (wrapper: Wrapper) => wrapper.value as {},
    })
    expectTypeOf<TypeOutput<typeof wrapped>>().toEqualTypeOf<Wrapper>()
    const nullable = t.jsonb.nullable().transform({ decode: value => new Wrapper(value) })
    expectTypeOf<TypeOutput<typeof nullable>>().toEqualTypeOf<Wrapper | null>()
    expectTypeOf<TypeInput<typeof nullable>>().toEqualTypeOf<{} | null>()
  })

  test("makes a type nullable whose `encode` takes null, also as unknown", () => {
    const optional = t.text.transform({
      decode: value => value,
      encode: (value: string | null) => value ?? "",
    })
    expectTypeOf<TypeOutput<typeof optional>>().toEqualTypeOf<string | null>()
    const anything = t.text.transform({
      decode: value => value,
      encode: (value: unknown) => String(value),
    })
    expectTypeOf<TypeOutput<typeof anything>>().toEqualTypeOf<string | null>()
    const length = anything.transform({ decode: value => value.length })
    expectTypeOf<TypeOutput<typeof length>>().toEqualTypeOf<number | null>()
  })

  test("without `encode` accepts the values of the original type", () => {
    // @ts-expect-error Without `encode`, a transformed type accepts the values of the original type.
    t.text.transform<number, number>({ decode: Number })

    const length = t.text.transform({ decode: value => value.length })
    // @ts-expect-error Without `encode`, compared values stay those of the original type.
    sql(length)`length(name)`.eq(3)
    sql(length)`name`.eq("abc")
  })
})

describe("of", () => {
  type FieldType = "text" | "email" | "choice"

  const field = defineTable("field", {
    id: t.integer.primaryKey(),
    type: t.text.of<FieldType>(),
    width: t.smallint.of<1 | 2>().nullable(),
  })

  test("narrows the values of selected rows", () => {
    expectTypeOf<Selectable<typeof field>>().toEqualTypeOf<{
      id: number
      type: FieldType
      width: 1 | 2 | null
    }>()
  })

  test("narrows the values of conditions and inserts", () => {
    from(field).where({ type: "email", width: 1 })
    // @ts-expect-error A condition takes the narrowed values.
    from(field).where({ type: "other" })

    const values: InsertValues<typeof field> = { id: 1, type: "choice", width: null }
    // @ts-expect-error An insert takes the narrowed values.
    const other: InsertValues<typeof field> = { id: 1, type: "other", width: null }
    void [values, other]
  })

  test("narrows the operands of generic operators, keeping string patterns", () => {
    from(field).where(columns => columns.type.in(["text", "email"]))
    // @ts-expect-error `in` takes the narrowed values.
    from(field).where(columns => columns.type.in(["other"]))
    // @ts-expect-error `gt` takes the narrowed values.
    from(field).where(columns => columns.width.gt(0))
    from(field).where(columns => columns.type.like("e%"))
  })

  test("keeps `null` of a nullable type apart from the narrowed values", () => {
    const narrowed = t.text.nullable().of<"a">()
    expectTypeOf<TypeOutput<typeof narrowed>>().toEqualTypeOf<"a" | null>()
    expectTypeOf<TypeInput<typeof narrowed>>().toEqualTypeOf<"a" | null>()

    type Options = { choices: string[] }
    const optionsAfter = t.jsonb.nullable().of<Options>()
    expectTypeOf<TypeOutput<typeof optionsAfter>>().toEqualTypeOf<Options | null>()
    expectTypeOf<TypeInput<typeof optionsAfter>>().toEqualTypeOf<Options | null>()
    const optionsBefore = t.jsonb.of<Options>().nullable()
    expectTypeOf<TypeOutput<typeof optionsBefore>>().toEqualTypeOf<Options | null>()

    const anything = t.text
      .transform({
        decode: value => value,
        encode: (value: unknown) => String(value),
      })
      .of<"a">()
    expectTypeOf<TypeOutput<typeof anything>>().toEqualTypeOf<"a" | null>()
    expectTypeOf<TypeInput<typeof anything>>().toEqualTypeOf<"a" | null>()

    // @ts-expect-error `nullable` adds `null`, which the narrowed values leave out.
    t.text.of<"a" | null>()
  })

  test("keeps type parameters", () => {
    t.varchar.of<FieldType>().with(10)
    t.varchar.with(10).of<FieldType>()
  })

  test("takes only values that the type returns and accepts", () => {
    // @ts-expect-error The narrowed values are values of the type.
    t.text.of<1>()

    const dated = t.timestamptz.transform({ decode: value => new Date(value) })
    expectTypeOf<TypeInput<ReturnType<typeof dated.of<Date>>>>().toEqualTypeOf<Date>()

    const overlapping = t.jsonb.transform({
      decode: value => value as { value: string | number },
      encode: (value: { value: string | boolean }) => value,
    })
    overlapping.of<{ value: string }>()
    // @ts-expect-error A narrowed value is also accepted.
    overlapping.of<{ value: number }>()

    const length = t.text.transform({ decode: value => value.length })
    // @ts-expect-error A type that decodes text into numbers without `encode` accepts no number.
    length.of<1>()
  })
})

describe("with", () => {
  test("is available on a type with PostgreSQL type parameters", () => {
    t.varchar.with(10)

    // @ts-expect-error Only a type with PostgreSQL type parameters has `with`.
    t.text.with(10)
  })

  test("takes parameters typed by the type", () => {
    // @ts-expect-error Type parameters are typed by the type.
    t.varchar.with("10")
  })
})

describe("selected values", () => {
  const message = defineTable("message", {
    code: t.varchar.with(10),
    body: t.varchar,
    meta: t.jsonb.of<{ tags: string[] }>(),
    extra: t.jsonb,
  })

  test("are typed by the column types", () => {
    const row: Selectable<typeof message> = {
      code: "a",
      body: "b",
      meta: { tags: [] },
      extra: 1,
    }
    void row
  })

  test("of `jsonb` without a shape are unknown, which includes a JSON null value", () => {
    expectTypeOf<Selectable<typeof message>["extra"]>().toEqualTypeOf<unknown>()
  })

  test("of `jsonb` are typed by a declared JSON shape", () => {
    // @ts-expect-error A declared JSON shape types the values.
    const meta: Selectable<typeof message>["meta"] = { tags: "a" }
    void meta
  })
})

describe("accepted values", () => {
  test("of `jsonb` take null only for a nullable column", () => {
    const event = defineTable("event", {
      payload: t.jsonb,
      extra: t.jsonb.nullable(),
    })

    const values: InsertValues<typeof event> = { payload: { a: 1 } }
    // @ts-expect-error A column that is not nullable takes no null.
    const nulls: InsertValues<typeof event> = { payload: null, extra: null }
    // @ts-expect-error An insert requires a column that is not nullable.
    const missing: InsertValues<typeof event> = { extra: null }
    void [values, nulls, missing]
    // @ts-expect-error A condition takes null only for a nullable column.
    from(event).where({ payload: null })
  })
})

describe("sql and param", () => {
  test("take a type", () => {
    sql(t.timestamptz)`now()`.gt(new Date())
    param(t.bigint, 1).eq(1)
  })

  test("reject a column", () => {
    // @ts-expect-error A column is not a type.
    sql(t.uuid.primaryKey())

    // @ts-expect-error A column is not a type.
    param(t.uuid.columnName("account_id"), "id")
  })
})

describe("primaryKey", () => {
  test("rejects a nullable column", () => {
    // @ts-expect-error A primary key column is not nullable.
    t.uuid.nullable().primaryKey()

    // @ts-expect-error A primary key column is not nullable.
    t.uuid.nullable().columnName("account_id").primaryKey()
  })

  test("takes a type whose values include null when it is not nullable", () => {
    t.jsonb.primaryKey()

    // @ts-expect-error A primary key column is not nullable.
    t.jsonb.nullable().primaryKey()
  })
})
