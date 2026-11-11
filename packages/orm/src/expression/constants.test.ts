import { describe, expect, it } from "bun:test"

import { describePostgres } from "../../testing/postgres"
import { falseNode, trueNode } from "../ast/nodes"
import { bindSchema } from "../execution/db"
import { from } from "../query/select"
import { defineSchema } from "../schema/schema"
import { defineTable } from "../table/table"
import * as t from "../types"

import { FALSE, TRUE } from "./constants"
import { getType, toNode } from "./expression"
import { caseWhen } from "./functions"
import { and, not, or } from "./predicates"

const form = defineTable("form", {
  id: t.integer.primaryKey(),
  published: t.boolean,
})

describe("TRUE and FALSE", () => {
  it("are expressions of the constant nodes with the Boolean type", () => {
    expect(toNode(TRUE)).toBe(trueNode)
    expect(toNode(FALSE)).toBe(falseNode)
    expect(getType(TRUE)!.castType).toBe("boolean")
    expect(getType(FALSE)!.castType).toBe("boolean")
  })

  it("are dropped as a neutral branch beside an object of column values", () => {
    const query = from(form).select("id")

    expect(query.where(or({ published: true }, FALSE)).toSQL().text).toEndWith(
      'WHERE "form"."published" = $1',
    )
    expect(query.where(and({ published: true }, TRUE)).toSQL().text).toEndWith(
      'WHERE "form"."published" = $1',
    )
  })

  it("absorb the group that they decide", () => {
    const query = from(form).select("id")

    expect(query.where(and({ published: true }, FALSE)).toSQL().text).toEndWith("WHERE FALSE")
    expect(query.where(or({ published: true }, TRUE)).toSQL().text).toEndWith(
      'SELECT "form"."id" AS "id" FROM "form" AS "form"',
    )
    expect(toNode(not(TRUE))).toBe(falseNode)
  })

  it("are conditions of where and of caseWhen", () => {
    const query = from(form).select(() => ({
      value: caseWhen(t.integer, [[TRUE, 1]], 0),
    }))

    expect(from(form).select("id").where(FALSE).toSQL().text).toEndWith("WHERE FALSE")
    expect(query.toSQL().text).toStartWith("SELECT CASE WHEN TRUE THEN")
  })
})

describePostgres("in PostgreSQL", ({ database, testTransaction }) => {
  const db = bindSchema(defineSchema({ form }), database)

  it("selects and decodes them", async () => {
    const query = db.$select({
      always: TRUE,
      never: FALSE,
    })

    expect(await testTransaction(async () => await query)).toEqual({ always: true, never: false })
  })
})
