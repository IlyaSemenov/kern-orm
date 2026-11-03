import { expect, it } from "bun:test"

import { defineTable } from "../table/table"
import * as t from "../types"

import { isAggregateQuery } from "./aggregate"
import { isExistsQuery } from "./exists"
import { from } from "./select"

const post = defineTable("post", {
  title: t.text,
})

it("tells a query of exists, also after the methods that keep its value", () => {
  const checked = from(post).exists().where({ title: "First" }).take().optional().coalesce(false)

  expect(isExistsQuery(from(post).exists().node)).toBe(true)
  expect(isExistsQuery(checked.node)).toBe(true)
  expect(isAggregateQuery(from(post).exists().node)).toBe(false)
  expect(isExistsQuery(from(post).count().node)).toBe(false)
  expect(isExistsQuery(from(post).get(columns => columns.title.eq("First")).node)).toBe(false)
  expect(isExistsQuery(from(post).node)).toBe(false)
})
