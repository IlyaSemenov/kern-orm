import { expect, it } from "bun:test"

import { defineTable } from "../table/table"
import * as t from "../types"

import { createPageCount } from "./pagination"
import { from } from "./select"

const post = defineTable("post", {
  title: t.text,
})

it("rejects a query of one row", () => {
  const { node } = from(post).take()

  expect(() => createPageCount(node, "limit", 1)).toThrow(
    "limit applies only to a query of many rows; call it before take or get",
  )
  expect(() => createPageCount(node, "offset", 1)).toThrow(
    "offset applies only to a query of many rows; call it before take or get",
  )
})

it("rejects an aggregate query, which aggregates the rows of a page of a limit and an offset before it", () => {
  for (const { node } of [from(post).count().where({ title: "First" }), from(post).max("title")]) {
    expect(() => createPageCount(node, "limit", 1)).toThrow(
      "limit applies only to a query of many rows; call it before count or another aggregate to aggregate the rows of a page",
    )
  }
})

it("rejects a query of exists, which checks the rows of a page of a limit and an offset before it", () => {
  const { node } = from(post).exists().where({ title: "First" })

  expect(() => createPageCount(node, "offset", 1)).toThrow(
    "offset applies only to a query of many rows; call it before exists to check the rows of a page",
  )
})

it("rejects a number of rows that is not a non-negative integer", () => {
  const { node } = from(post)

  for (const count of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53]) {
    expect(() => createPageCount(node, "limit", count)).toThrow(
      `limit takes a non-negative integer, not ${count}`,
    )
    expect(() => createPageCount(node, "offset", count)).toThrow(
      `offset takes a non-negative integer, not ${count}`,
    )
  }
})
