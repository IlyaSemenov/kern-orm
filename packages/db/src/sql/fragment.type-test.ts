import { describe, test } from "bun:test"

import { array } from "../type/builtins/array"
import { timestamptz } from "../type/builtins/datetime"
import { jsonb } from "../type/builtins/json"
import { integer } from "../type/builtins/numeric"
import type { Type } from "../type/type"

import type { SqlFragment } from "./fragment"
import { identifier, param, sql } from "./fragment"

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
