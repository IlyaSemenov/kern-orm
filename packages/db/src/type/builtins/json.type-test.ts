import { describe, expectTypeOf, test } from "bun:test"

import { param } from "../../sql/fragment"
import type { DerivableType, TypeInput, TypeOutput } from "../type"

import { array } from "./array"
import type { JsonNull } from "./json"
import { jsonb, jsonbWithJsonNull, jsonNull, jsonWithJsonNull } from "./json"

type Payload = { url?: string }

describe("jsonWithJsonNull and jsonbWithJsonNull", () => {
  test("have the values other than null and undefined, which include the marker", () => {
    expectTypeOf(jsonWithJsonNull).toEqualTypeOf<DerivableType<{}, {}>>()
    expectTypeOf(jsonbWithJsonNull).toEqualTypeOf<DerivableType<{}, {}>>()
    param(jsonbWithJsonNull, jsonNull)
    // @ts-expect-error `null` is `NULL`, which only a nullable type takes.
    param(jsonbWithJsonNull, null)
    param(jsonbWithJsonNull.nullable(), null)
    // @ts-expect-error A parameter has no `undefined`.
    param(jsonbWithJsonNull, undefined)
  })

  test("have the marker in a declared shape that includes it, apart from null of a nullable type", () => {
    const payload = jsonbWithJsonNull.of<Payload | JsonNull>()
    expectTypeOf<TypeOutput<typeof payload>>().toEqualTypeOf<Payload | JsonNull>()
    expectTypeOf<TypeInput<typeof payload>>().toEqualTypeOf<Payload | JsonNull>()

    const nullableAfter = payload.nullable()
    expectTypeOf<TypeOutput<typeof nullableAfter>>().toEqualTypeOf<Payload | JsonNull | null>()
    expectTypeOf<TypeInput<typeof nullableAfter>>().toEqualTypeOf<Payload | JsonNull | null>()
    const nullableBefore = jsonbWithJsonNull.nullable().of<Payload | JsonNull>()
    expectTypeOf(nullableBefore).toEqualTypeOf(nullableAfter)

    const optional = payload.nullableAs(() => undefined)
    expectTypeOf<TypeOutput<typeof optional>>().toEqualTypeOf<Payload | JsonNull | undefined>()
    expectTypeOf<TypeInput<typeof optional>>().toEqualTypeOf<Payload | JsonNull | null>()

    const payloads = array(nullableAfter)
    expectTypeOf<TypeOutput<typeof payloads>>().toEqualTypeOf<(Payload | JsonNull | null)[]>()

    // @ts-expect-error `nullable` adds `null`, which a shape leaves out.
    jsonbWithJsonNull.of<Payload | null>()
  })

  test("leave the marker out of a shape that does not include it", () => {
    const payload = jsonbWithJsonNull.of<Payload>()
    expectTypeOf<TypeOutput<typeof payload>>().toEqualTypeOf<Payload>()
    // @ts-expect-error The shape does not include the marker.
    param(payload, jsonNull)
  })

  test("leave Payload after excluding null and jsonNull", () => {
    const describe = (value: Payload | JsonNull | null) => {
      if (value === null || value === jsonNull) {
        return undefined
      }
      expectTypeOf(value).toEqualTypeOf<Payload>()
      return value.url
    }
    void describe
  })

  test("give a transform the marker as a value", () => {
    const kind = jsonbWithJsonNull.of<Payload | JsonNull>().transform({
      decode(value) {
        expectTypeOf(value).toEqualTypeOf<Payload | JsonNull>()
        return value === jsonNull ? ("null" as const) : ("value" as const)
      },
    })
    expectTypeOf<TypeOutput<typeof kind>>().toEqualTypeOf<"null" | "value">()
    expectTypeOf<TypeInput<typeof kind>>().toEqualTypeOf<Payload | JsonNull>()
  })
})

describe("jsonb", () => {
  test("rejects jsonNull for a shape that excludes it", () => {
    // @ts-expect-error `Payload` excludes `jsonNull`.
    param(jsonb.of<Payload>(), jsonNull)
  })
})
