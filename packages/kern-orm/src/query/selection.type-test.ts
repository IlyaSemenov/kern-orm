import { describe, expectTypeOf, test } from "bun:test"

import type { HelperFields, MergeSelection } from "./selection"

describe("MergeSelection", () => {
  test("replaces overlapping fields in every branch of the previous records", () => {
    type Result = MergeSelection<
      { id: string; value: string } | { value: boolean },
      { value: number }
    >

    expectTypeOf<Result>().toEqualTypeOf<{ id: string; value: number } | { value: number }>()
  })

  test("merges each branch of the selection independently", () => {
    type Result = MergeSelection<{ id: string; name: string }, { id: number } | { name: boolean }>

    expectTypeOf<Result>().toEqualTypeOf<
      { id: number; name: string } | { id: string; name: boolean }
    >()
  })

  test("normalizes numeric keys in both records before replacing fields", () => {
    type Result = MergeSelection<{ 0: string } | { id: string }, { "0": number }>
    expectTypeOf<Result>().toEqualTypeOf<{ "0": number } | { id: string; "0": number }>()
    expectTypeOf<MergeSelection<{ "0": string }, { 0: number }>>().toEqualTypeOf<{ "0": number }>()
  })

  test("keeps input values and requiredness for optional replacements", () => {
    type Result = MergeSelection<{ id: string }, { id?: number; name?: string }>
    expectTypeOf<Result>().toEqualTypeOf<{ id: string | number | undefined; name?: string }>()
    expectTypeOf<MergeSelection<{ id?: string }, { id: number }>>().toEqualTypeOf<{ id: number }>()
    expectTypeOf<MergeSelection<{ id: string }, { id?: undefined }>>().toEqualTypeOf<{
      id: string | undefined
    }>()
  })

  test("tracks selected keys in the helper marker", () => {
    type Named = MergeSelection<HelperFields<never>, { name: string }>
    type Identified = MergeSelection<Named, { id: number; name: boolean }>

    expectTypeOf<Named[keyof HelperFields]>().toEqualTypeOf<"name">()
    expectTypeOf<Identified[keyof HelperFields]>().toEqualTypeOf<"name" | "id">()
    expectTypeOf<Omit<Identified, keyof HelperFields>>().toEqualTypeOf<{
      id: number
      name: boolean
    }>()
    expectTypeOf<Named extends HelperFields<never> ? true : false>().toEqualTypeOf<false>()
    expectTypeOf<Identified extends Named ? true : false>().toEqualTypeOf<false>()
  })
})
