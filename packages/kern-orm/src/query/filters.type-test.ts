import { test } from "bun:test"

import { createRecordingDriver } from "../../testing/recording-driver"
import { createDatabase } from "../execution/database"
import { and, not, or } from "../expression/predicates"
import { defineSchema } from "../schema/schema"
import { defineTable } from "../table/table"
import * as t from "../types"

import type { WhereCondition, WhereFilter } from "./filters"
import { defineFilter } from "./filters"
import { from } from "./select"

const form = defineTable("form", {
  name: t.text,
  published: t.boolean,
  hint: t.text.nullable(),
})

const schema = defineSchema({ form })
const db = createDatabase({ driver: createRecordingDriver().driver }).bind(schema)

test("defineFilter defines filters of a table or a query", () => {
  const condition = defineFilter(form, or({ published: true }, { hint: null }))
  const filter = defineFilter(form, columns =>
    not(or({ published: true }, columns.name.ilike("draft%"))),
  )
  const ofQuery = defineFilter(from(form), columns => columns.name.eq("Draft"))
  const pick = (published: boolean) => defineFilter(form, published ? { published } : filter)
  from(form).where(condition).where(filter).where(ofQuery).where(pick(true))
})

test("defineFilter defines filters of a table of a Db for queries of either kind", () => {
  const condition = defineFilter(db.form, { published: true })
  const filter = defineFilter(db.form, columns => columns.name.eq("Draft"))
  db.form.where(condition).where(filter)
  schema.form.where(condition).where(filter)
})

test("defineFilter checks objects against the table", () => {
  // @ts-expect-error Object keys are columns of the table.
  defineFilter(form, or({ published: true }, { nmae: "Draft" }))

  // @ts-expect-error Object keys are columns of the table of the query.
  defineFilter(from(form), { nmae: "Draft" })

  // @ts-expect-error Object keys are columns of the table of a Db.
  defineFilter(db.form, { nmae: "Draft" })

  // @ts-expect-error Object keys of a callback result are columns of the table.
  defineFilter(form, columns => and({ pblished: true }, columns.name.eq("Draft")))
})

test("an annotation checks objects against its table", () => {
  const condition: WhereCondition<typeof form> = or({ published: true }, { hint: null })
  const filter: WhereFilter<typeof form> = columns =>
    not(or({ published: true }, columns.name.ilike("draft%")))
  from(form).where(condition).where(filter)

  // @ts-expect-error Object keys are columns of the annotated table.
  const misspelled: WhereCondition<typeof form> = or({ published: true, nmae: "Draft" })
  void misspelled
})
