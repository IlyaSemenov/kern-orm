import { expect, it } from "bun:test"

import { from } from "../../query/select"
import { defineTable } from "../../table/table"
import * as t from "../../types"
import { and } from "../predicates"

it("ordering operators compare ordered types with operands of their type", () => {
  const event = defineTable("event", {
    at: t.timestamptz,
    rank: t.integer,
  })
  const after = new Date("2026-01-01T00:00:00Z")

  expect(
    from(event)
      .where(columns => and(columns.at.gte(after), columns.rank.lt(10)))
      .toSQL(),
  ).toMatchObject({
    text: 'SELECT FROM "event" AS "event" WHERE "event"."at" >= $1 AND "event"."rank" < $2',
    parameters: ["2026-01-01T00:00:00.000Z", "10"],
  })
})
