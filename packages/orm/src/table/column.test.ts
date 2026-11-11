import { expect, it } from "bun:test"

import * as t from "../types"

it("marks the key that a column forms alone, keeping its name", () => {
  expect(t.uuid.primaryKey().attributes).toEqual({
    name: undefined,
    keyKind: "primaryKey",
    hasDefault: false,
  })
  expect(t.text.columnName("email").unique().attributes).toEqual({
    name: "email",
    keyKind: "unique",
    hasDefault: false,
  })
  expect(t.uuid.primaryKey().columnName("user_id").attributes).toEqual({
    name: "user_id",
    keyKind: "primaryKey",
    hasDefault: false,
  })
  expect(t.uuid.columnName("user_id").attributes).toEqual({
    name: "user_id",
    keyKind: undefined,
    hasDefault: false,
  })
})

it("marks a column with a default, keeping its name and key in any order", () => {
  expect(t.uuid.hasDefault().attributes).toEqual({
    name: undefined,
    keyKind: undefined,
    hasDefault: true,
  })
  expect(t.uuid.primaryKey().hasDefault().columnName("user_id").attributes).toEqual({
    name: "user_id",
    keyKind: "primaryKey",
    hasDefault: true,
  })
  expect(t.uuid.hasDefault().columnName("user_id").primaryKey().attributes).toEqual({
    name: "user_id",
    keyKind: "primaryKey",
    hasDefault: true,
  })
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
