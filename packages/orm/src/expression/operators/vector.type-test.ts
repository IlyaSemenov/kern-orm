import { expectTypeOf, test } from "bun:test"

import type { ResultOf } from "../../query/select"
import { from } from "../../query/select"
import { defineTable } from "../../table/table"
import * as t from "../../types"

const document = defineTable("document", {
  embedding: t.vector.with(3),
  summary: t.vector.with(3).nullable(),
  title: t.text,
})

const documents = from(document)

test("vectors are arrays of numbers", () => {
  const query = documents.select("embedding", "summary")

  expectTypeOf<ResultOf<typeof query>>().toEqualTypeOf<{
    embedding: number[]
    summary: number[] | null
  }>()

  documents.where({ embedding: [1, 2, 3] })
  // @ts-expect-error A vector is an array of numbers.
  documents.where({ embedding: ["1"] })
})

test("a distance is a number and NULL when an operand can be NULL", () => {
  const query = documents.select(columns => ({
    distance: columns.embedding.cosineDistance([1, 2, 3]),
    nullableSelf: columns.summary.l2Distance([1, 2, 3]),
    nullableOperand: columns.embedding.l1Distance(columns.summary),
  }))

  expectTypeOf<ResultOf<typeof query>>().toEqualTypeOf<{
    distance: number
    nullableSelf: number | null
    nullableOperand: number | null
  }>()
})

test("operands are vectors, and a distance has the operators of numbers", () => {
  documents.where(columns =>
    columns.embedding.negativeInnerProduct(columns.summary).mul(-1).gt(0.5),
  )

  // @ts-expect-error An operand of a vector is an array of numbers.
  documents.where(columns => columns.embedding.l2Distance([1, "2"]).lt(1))
  // @ts-expect-error A text expression is not an operand of a vector.
  documents.where(columns => columns.embedding.l2Distance(columns.title).lt(1))
})

test("distances are absent on other types", () => {
  // @ts-expect-error Text has no distances.
  documents.where(columns => columns.title.l2Distance("a").lt(1))
})
