import { expect, it } from "bun:test"

import * as t from "../types"

it("marks the key that a column forms alone, keeping its name", () => {
  expect(t.uuid.primaryKey().attributes).toEqual({
    name: undefined,
    keyKind: "primaryKey",
    hasDefault: false,
    default: undefined,
  })
  expect(t.text.columnName("email").unique().attributes).toEqual({
    name: "email",
    keyKind: "unique",
    hasDefault: false,
    default: undefined,
  })
  expect(t.uuid.primaryKey().columnName("user_id").attributes).toEqual({
    name: "user_id",
    keyKind: "primaryKey",
    hasDefault: false,
    default: undefined,
  })
  expect(t.uuid.columnName("user_id").attributes).toEqual({
    name: "user_id",
    keyKind: undefined,
    hasDefault: false,
    default: undefined,
  })
})

it("marks a column with a default, keeping its name and key in any order", () => {
  expect(t.uuid.hasDefault().attributes).toEqual({
    name: undefined,
    keyKind: undefined,
    hasDefault: true,
    default: undefined,
  })
  expect(t.uuid.primaryKey().hasDefault().columnName("user_id").attributes).toEqual({
    name: "user_id",
    keyKind: "primaryKey",
    hasDefault: true,
    default: undefined,
  })
  expect(t.uuid.hasDefault().columnName("user_id").primaryKey().attributes).toEqual({
    name: "user_id",
    keyKind: "primaryKey",
    hasDefault: true,
    default: undefined,
  })
})

it("gives a column a default of kern-orm, keeping its other attributes", () => {
  const create = () => "draft"
  expect(t.text.default("draft").attributes).toEqual({
    name: undefined,
    keyKind: undefined,
    hasDefault: false,
    default: "draft",
  })
  expect(t.text.unique().hasDefault().default(create).columnName("state").attributes).toEqual({
    name: "state",
    keyKind: "unique",
    hasDefault: true,
    default: create,
  })
  expect(t.text.default("draft").default(create).attributes.default).toBe(create)
})

it("rejects a default of undefined", () => {
  const message =
    "default takes a value or a function that returns it, not undefined; omit default to insert the default of the database"
  // @ts-expect-error A default is a value other than undefined.
  expect(() => t.json.default(undefined)).toThrow(message)
  // @ts-expect-error A default is a value other than undefined.
  expect(() => t.json.columnName("data").default(undefined)).toThrow(message)
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
