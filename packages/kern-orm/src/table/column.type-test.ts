import { expectTypeOf, test } from "bun:test"

import * as t from "../types"

import type { Column } from "./column"

test("types the key that a column forms alone, keeping it after columnName", () => {
  expectTypeOf(t.uuid.primaryKey()).toEqualTypeOf<Column<typeof t.uuid, "primaryKey">>()
  expectTypeOf(t.text.unique()).toEqualTypeOf<Column<typeof t.text, "unique">>()
  expectTypeOf(t.uuid.columnName("user_id")).toEqualTypeOf<Column<typeof t.uuid, undefined>>()
  expectTypeOf(t.text.columnName("email").unique()).toEqualTypeOf<Column<typeof t.text, "unique">>()
  expectTypeOf(t.uuid.primaryKey().columnName("user_id")).toEqualTypeOf<
    Column<typeof t.uuid, "primaryKey">
  >()
})

test("rejects marking a column that forms a key or whose type does not tell its key", () => {
  const id: Column<typeof t.uuid> = t.uuid.primaryKey()

  // @ts-expect-error A column forms one key.
  t.uuid.primaryKey().unique()
  // @ts-expect-error A column forms one key.
  t.text.unique().columnName("email").primaryKey()
  // @ts-expect-error The type of the column does not tell its key.
  id.unique()
})
