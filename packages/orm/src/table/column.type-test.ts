import { expectTypeOf, test } from "bun:test"

import { sql } from "../expression/sql"
import * as t from "../types"

import type { Column } from "./column"

test("types the key that a column forms alone, keeping it after columnName", () => {
  expectTypeOf(t.uuid.primaryKey()).toEqualTypeOf<Column<typeof t.uuid, "primaryKey", false>>()
  expectTypeOf(t.text.unique()).toEqualTypeOf<Column<typeof t.text, "unique", false>>()
  expectTypeOf(t.uuid.columnName("user_id")).toEqualTypeOf<
    Column<typeof t.uuid, undefined, false>
  >()
  expectTypeOf(t.text.columnName("email").unique()).toEqualTypeOf<
    Column<typeof t.text, "unique", false>
  >()
  expectTypeOf(t.uuid.primaryKey().columnName("user_id")).toEqualTypeOf<
    Column<typeof t.uuid, "primaryKey", false>
  >()
})

test("types a column with a default, keeping it after the other attributes", () => {
  expectTypeOf(t.uuid.hasDefault()).toEqualTypeOf<Column<typeof t.uuid, undefined, true>>()
  expectTypeOf(t.uuid.hasDefault().columnName("user_id").primaryKey()).toEqualTypeOf<
    Column<typeof t.uuid, "primaryKey", true>
  >()
  expectTypeOf(t.text.unique().hasDefault()).toEqualTypeOf<Column<typeof t.text, "unique", true>>()
})

test("types a column with a default of kern-orm, keeping its key", () => {
  expectTypeOf(t.text.default("draft")).toEqualTypeOf<Column<typeof t.text, undefined, true>>()
  expectTypeOf(t.doublePrecision.unique().default(() => Math.random())).toEqualTypeOf<
    Column<typeof t.doublePrecision, "unique", true>
  >()
  expectTypeOf(t.timestamptz.default(() => sql`now()`)).toEqualTypeOf<
    Column<typeof t.timestamptz, undefined, true>
  >()
})

test("rejects a default that the type of the column does not take", () => {
  // @ts-expect-error A default is a value of the type of the column.
  t.integer.default("1")
  // @ts-expect-error A function returns a value of the type of the column.
  t.integer.columnName("count").default(() => "1")
  // @ts-expect-error An expression of a column that is not nullable is not NULL.
  t.text.default(sql<string | null>`NULL`)
})

test("rejects marking a column that forms a key or whose type does not tell its key", () => {
  const id: Column<typeof t.uuid> = t.uuid.primaryKey().hasDefault()

  // @ts-expect-error A column forms one key.
  t.uuid.primaryKey().unique()
  // @ts-expect-error A column forms one key.
  t.text.unique().columnName("email").primaryKey()
  // @ts-expect-error The type of the column does not tell its key.
  id.unique()
})

test("rejects a primary key of a type that accepts null", () => {
  t.jsonb.columnName("payload").primaryKey()

  // @ts-expect-error A primary key column is not nullable.
  t.jsonb.nullable().columnName("payload").primaryKey()
  const optional = t.text.transform({
    decode: value => value,
    encode: (value: string | null) => value ?? "",
  })
  // @ts-expect-error A type whose `encode` takes null is nullable.
  optional.columnName("code").primaryKey()
})
