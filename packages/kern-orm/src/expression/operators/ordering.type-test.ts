import { test } from "bun:test"

import { from } from "../../query/select"
import { defineTable } from "../../table/table"
import * as t from "../../types"

const event = defineTable("event", {
  at: t.timestamptz.nullable(),
  rank: t.integer,
  done: t.boolean,
})

test("ordering operators take operands of the expression type", () => {
  from(event).where(columns => columns.at.gt(new Date()))
  from(event).where(columns => columns.at.gt("2026-01-01T00:00:00Z"))

  // @ts-expect-error Ordering operators take operands of the expression type.
  from(event).where(columns => columns.rank.gt("1"))
})

test("ordering operators are absent on boolean columns", () => {
  // @ts-expect-error Boolean columns have no ordering operators.
  from(event).where(columns => columns.done.lt(true))
})
