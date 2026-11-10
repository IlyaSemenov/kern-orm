import { describe, test } from "bun:test"

import type { Codec } from "../codec/codec"
import { array } from "../codecs/array"
import { timestamptz } from "../codecs/datetime"
import { jsonb } from "../codecs/json"
import { integer } from "../codecs/numeric"

import type { SqlFragment } from "./fragment"
import { identifier, param, sql } from "./fragment"

describe("sql", () => {
  test("takes the values of parameters without a codec and fragments", () => {
    sql`SELECT ${"text"}, ${1}, ${1n}, ${true}, ${null}, ${new Date()}, ${new Uint8Array()}` satisfies SqlFragment
    sql`SELECT ${identifier("name")} FROM ${sql`form`} WHERE id = ${param(integer, 1)}` satisfies SqlFragment
  })

  test("rejects an object, an array, and undefined", () => {
    // @ts-expect-error An object takes param with a codec, such as of jsonb.
    void sql`SELECT ${{ name: "Survey" }}`
    // @ts-expect-error An array takes param with a codec of an array.
    void sql`SELECT ${[1, 2]}`
    // @ts-expect-error NULL is null.
    void sql`SELECT ${undefined}`
  })
})

describe("param", () => {
  test("takes the values that its codec accepts", () => {
    param(integer, 1)
    param(integer.nullable(), null)
    param(array(integer), [1, 2])
    param(jsonb.of<{ choices: string[] }>(), { choices: [] })
    param(timestamptz, new Date())
    param(timestamptz, "2026-01-02")
  })

  test("takes a codec typed by its contract alone", () => {
    const codec = integer as Codec<number>

    param(codec, 1)
  })

  test("rejects a value that its codec does not accept", () => {
    // @ts-expect-error A codec of integers accepts no string.
    param(integer, "1")
    // @ts-expect-error A codec that is not nullable accepts no null.
    param(integer, null)
    // @ts-expect-error The shape of the JSON values requires `choices`.
    param(jsonb.of<{ choices: string[] }>(), {})
  })
})
