import { expectTypeOf, test } from "bun:test"

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
