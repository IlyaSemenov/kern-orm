import { expect, it } from "bun:test"

import * as t from "../types"

it("marks the key that a column forms alone, keeping its name", () => {
  expect(t.uuid.primaryKey().attributes).toEqual({ name: undefined, keyKind: "primaryKey" })
  expect(t.text.columnName("email").unique().attributes).toEqual({
    name: "email",
    keyKind: "unique",
  })
  expect(t.uuid.primaryKey().columnName("user_id").attributes).toEqual({
    name: "user_id",
    keyKind: "primaryKey",
  })
  expect(t.uuid.columnName("user_id").attributes).toEqual({ name: "user_id", keyKind: undefined })
})

it("rejects marking a column that already forms a key", () => {
  // @ts-expect-error A column forms one key.
  expect(() => t.uuid.primaryKey().unique()).toThrow(
    "A column marked with primaryKey() cannot be marked with unique()",
  )
  // @ts-expect-error A column forms one key.
  expect(() => t.uuid.unique().columnName("id").primaryKey()).toThrow(
    "A column marked with unique() cannot be marked with primaryKey()",
  )
})
