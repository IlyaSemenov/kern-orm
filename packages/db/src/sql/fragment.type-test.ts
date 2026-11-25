import { describe, test } from "bun:test"

import { array } from "../type/builtins/array"
import { timestamptz } from "../type/builtins/datetime"
import { jsonb } from "../type/builtins/json"
import { integer } from "../type/builtins/numeric"
import type { Type } from "../type/type"

import type { SqlFragment } from "./fragment"
import { identifier, joinSql, literal, param, sql, unsafeSql } from "./fragment"

describe("sql", () => {
  test("takes the values of parameters without a type and fragments", () => {
    sql`SELECT ${"text"}, ${1}, ${1n}, ${true}, ${null}, ${new Date()}, ${new Uint8Array()}` satisfies SqlFragment
    sql`SELECT ${identifier("name")} FROM ${sql`form`} WHERE id = ${param(integer, 1)}` satisfies SqlFragment
  })

  test("rejects an object of the members of a fragment and a copy of a fragment, which only the functions of fragments create", () => {
    const shaped = { strings: ["SELECT 1"], values: [] }
    const copy = { ...sql`SELECT 1` }

    // @ts-expect-error A fragment is created by sql, identifier, or param.
    void sql`SELECT ${shaped}`
    // @ts-expect-error A copy of a fragment is not a fragment.
    void sql`SELECT ${copy}`
  })

  test("rejects an object, an array, and undefined", () => {
    // @ts-expect-error An object takes param with a type, such as of jsonb.
    void sql`SELECT ${{ name: "Survey" }}`
    // @ts-expect-error An array takes param with a type of an array.
    void sql`SELECT ${[1, 2]}`
    // @ts-expect-error NULL is null.
    void sql`SELECT ${undefined}`
  })
})

describe("joinSql", () => {
  test("takes fragments and the values of parameters without a type, and a fragment as its separator", () => {
    joinSql([sql`(${1}, ${"Survey"})`, identifier("name"), param(integer, 1)]) satisfies SqlFragment
    joinSql([1, "text", null, new Date()], sql` AND `) satisfies SqlFragment
  })

  test("rejects an object, undefined, and a separator that is not a fragment", () => {
    // @ts-expect-error An object takes param with a type, such as of jsonb.
    void joinSql([{ name: "Survey" }])
    // @ts-expect-error NULL is null.
    void joinSql([undefined])
    // @ts-expect-error The separator is a fragment.
    void joinSql([1, 2], " AND ")
  })
})

describe("literal", () => {
  test("takes the values of parameters without a type", () => {
    for (const value of ["text", 1, 1n, true, null, new Date(), new Uint8Array()]) {
      literal(value) satisfies SqlFragment
    }
  })

  test("rejects an object, an array, a fragment, and undefined", () => {
    // @ts-expect-error A literal of JSON is that of its text.
    literal({ name: "Survey" })
    // @ts-expect-error An array has no literal.
    literal([1, 2])
    // @ts-expect-error A fragment is interpolated as it is.
    literal(sql`now()`)
    // @ts-expect-error NULL is null.
    literal(undefined)
  })
})

describe("unsafeSql", () => {
  test("takes SQL text as a string", () => {
    unsafeSql("DESC") satisfies SqlFragment
    // @ts-expect-error The text is a string.
    unsafeSql(1)
    // @ts-expect-error A fragment is interpolated as it is.
    unsafeSql(sql`DESC`)
  })
})

describe("param", () => {
  test("takes the values that its type accepts", () => {
    param(integer, 1)
    param(integer.nullable(), null)
    param(array(integer), [1, 2])
    param(jsonb.of<{ choices: string[] }>(), { choices: [] })
    param(timestamptz, new Date())
    param(timestamptz, "2026-01-02")
  })

  test("takes a value typed as `Type` alone", () => {
    const type = integer as Type<number>

    param(type, 1)
  })

  test("rejects a value that its type does not accept", () => {
    // @ts-expect-error A type of integers accepts no string.
    param(integer, "1")
    // @ts-expect-error A type that is not nullable accepts no null.
    param(integer, null)
    // @ts-expect-error The shape of the JSON values requires `choices`.
    param(jsonb.of<{ choices: string[] }>(), {})
  })
})
