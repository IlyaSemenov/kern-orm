import { test } from "bun:test"

import { not, or } from "../expression/predicates"
import { defineTable } from "../table/table"
import * as t from "../types"

import type { WhereCondition, WhereFilter } from "./filters"
import { from } from "./select"

const form = defineTable("form", {
  name: t.text,
  published: t.boolean,
  hint: t.text.nullable(),
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
