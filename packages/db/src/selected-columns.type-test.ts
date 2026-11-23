import { describe, expectTypeOf, test } from "bun:test"

import type { GuaranteedColumnKeys } from "./selected-columns"

describe("GuaranteedColumnKeys", () => {
  test("are the keys of fixed elements on either side of a spread", () => {
    expectTypeOf<GuaranteedColumnKeys<["id", "name"]>>().toEqualTypeOf<"id" | "name">()
    expectTypeOf<GuaranteedColumnKeys<["id", ...string[], "name"]>>().toEqualTypeOf<"id" | "name">()
    expectTypeOf<GuaranteedColumnKeys<["id" | "name"]>>().toEqualTypeOf<never>()
    expectTypeOf<GuaranteedColumnKeys<[`col_${number}`]>>().toEqualTypeOf<never>()
  })

  test("of a union of lists are the keys that every list guarantees", () => {
    expectTypeOf<GuaranteedColumnKeys<["id", "name"] | ["id"]>>().toEqualTypeOf<"id">()
    expectTypeOf<GuaranteedColumnKeys<["id"] | ["name"]>>().toEqualTypeOf<never>()
    expectTypeOf<GuaranteedColumnKeys<never>>().toEqualTypeOf<never>()
  })

  test("are keys of the lists for a generic list, such as of Pick", () => {
    /** Record of the keys that list `C` of keys of `Row` guarantees. */
    type Guaranteed<Row, C extends readonly (keyof Row)[]> = Pick<Row, GuaranteedColumnKeys<C>>

    expectTypeOf<Guaranteed<{ id: number; name: string }, ["id"]>>().toEqualTypeOf<{
      id: number
    }>()
  })
})
