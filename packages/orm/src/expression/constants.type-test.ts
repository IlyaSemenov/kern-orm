import { expectTypeOf, test } from "bun:test"

import type { ResultOf } from "../query/select"
import { from } from "../query/select"
import { defineTable } from "../table/table"
import * as t from "../types"

import { FALSE, TRUE } from "./constants"
import { caseWhen } from "./functions"
import { and, not, or } from "./predicates"

const form = defineTable("form", {
  name: t.text,
  published: t.boolean,
})

const isAdmin = Boolean(process.env.ADMIN)

test("are the neutral branches of conditions built in code", () => {
  from(form).where(columns => or({ published: true }, isAdmin ? columns.name.like("a%") : FALSE))
  from(form).where(columns => and({ published: true }, isAdmin ? columns.name.like("a%") : TRUE))
})

test("are conditions wherever one is taken", () => {
  from(form).where(FALSE)
  from(form).where(() => TRUE)
  from(form).where(not(TRUE))
  caseWhen(t.integer, [[TRUE, 1]], 0)
})

test("select as Boolean values", () => {
  const query = from(form).select(() => ({
    always: TRUE,
    combined: or(TRUE, FALSE),
  }))

  expectTypeOf<ResultOf<typeof query>>().toEqualTypeOf<{ always: boolean; combined: boolean }>()
})

// TypeScript types `!columns.published` as `false`, so a condition that took plain Boolean values would silently take it too.
test("plain Boolean values and the negation of a column are not conditions", () => {
  // @ts-expect-error A plain Boolean value is not a condition; use `FALSE`.
  from(form).where(columns => or(columns.name.eq("x"), false))
  // @ts-expect-error The negation of a column is a plain Boolean value; use `not`.
  from(form).where(columns => or(columns.name.eq("x"), !columns.published))
  // @ts-expect-error A plain Boolean value is not a condition; use `FALSE`.
  from(form).where(false)
})
