import { describe, expect, it } from "bun:test"

import { defineTable } from "../table/table"
import * as t from "../types"

import { toKeyValues, toPrimaryKeyValues } from "./find"

const membership = defineTable(
  "membership",
  {
    userId: t.uuid,
    groupId: t.uuid.columnName("group_id"),
    code: t.text.nullable().unique(),
    role: t.text,
  },
  { primaryKey: ["userId", "groupId"] },
)

const log = defineTable("log", {
  id: t.uuid,
})

describe("toPrimaryKeyValues", () => {
  it("gives the values to the columns of the primary key in their order", () => {
    expect(toPrimaryKeyValues(membership, ["user-id", "group-id"])).toEqual({
      userId: "user-id",
      groupId: "group-id",
    })
  })

  it("rejects a table without a primary key", () => {
    expect(() => toPrimaryKeyValues(log, ["log-id"])).toThrow(
      'find takes the values of a primary key, which table "log" does not have; use findBy with a unique key',
    )
  })

  it("rejects a number of values other than the number of the columns of the primary key", () => {
    for (const values of [[], ["user-id"], ["user-id", "group-id", "role"]]) {
      expect(() => toPrimaryKeyValues(membership, values)).toThrow(
        `find takes one value for each column of the primary key of table "membership", "userId", "groupId", not ${values.length}`,
      )
    }
  })

  it("rejects null and undefined", () => {
    expect(() => toPrimaryKeyValues(membership, ["user-id", null])).toThrow(
      'find got null for column "groupId" of table "membership"; a value of a key is never null or undefined',
    )
    expect(() => toPrimaryKeyValues(membership, [undefined, "group-id"])).toThrow(
      'find got undefined for column "userId" of table "membership"; a value of a key is never null or undefined',
    )
  })
})

describe("toKeyValues", () => {
  it("copies the values of the columns of a key, primary or unique, in any order", () => {
    const values = { groupId: "group-id", userId: "user-id" }

    expect(toKeyValues(membership, values)).toEqual(values)
    expect(toKeyValues(membership, values)).not.toBe(values)
    expect(toKeyValues(membership, { code: "code" })).toEqual({ code: "code" })
  })

  it("rejects columns that are not exactly one key", () => {
    const message = 'findBy takes the columns of one key of table "membership", primary or unique'

    expect(() => toKeyValues(membership, { userId: "user-id" })).toThrow(
      `${message}, not columns "userId"`,
    )
    expect(() =>
      toKeyValues(membership, { userId: "user-id", groupId: "group-id", code: "code" }),
    ).toThrow(`${message}, not columns "userId", "groupId", "code"`)
    expect(() => toKeyValues(membership, { role: "admin" })).toThrow(
      `${message}, not columns "role"`,
    )
    expect(() => toKeyValues(membership, { toString: "code" })).toThrow(
      `${message}, not columns "toString"`,
    )
    expect(() => toKeyValues(membership, {})).toThrow(`${message}, not an object without columns`)
    expect(() => toKeyValues(log, { id: "log-id" })).toThrow(
      'findBy takes the columns of one key of table "log", primary or unique, not columns "id"',
    )
  })

  it("rejects a value that is not an object", () => {
    for (const values of [null, undefined, "code"]) {
      expect(() => toKeyValues(membership, values)).toThrow(
        'findBy takes an object of the columns of a key of table "membership"',
      )
    }
  })

  it("rejects null and undefined", () => {
    expect(() => toKeyValues(membership, { code: null })).toThrow(
      'findBy got null for column "code" of table "membership"; a value of a key is never null or undefined',
    )
    expect(() => toKeyValues(membership, { userId: "user-id", groupId: undefined })).toThrow(
      'findBy got undefined for column "groupId" of table "membership"; a value of a key is never null or undefined',
    )
  })
})
