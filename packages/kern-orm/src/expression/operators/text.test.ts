import { expect, it } from "bun:test"

import { from } from "../../query/select"
import { defineTable } from "../../table/table"
import { defineType } from "../../type/type"
import * as t from "../../types"
import type { AnyExpression } from "../expression"
import { param, sql } from "../sql"

import { defineGenericOperator } from "./generic"
import type { PatternSignature } from "./text"
import { textOperators } from "./text"

const user = defineTable("user", {
  name: t.text,
})

const prefix = "prefix:"
// Text whose encoding differs from the pattern, which is sent as it is.
const encodedText = defineType({ sqlType: "text" }).transform({
  decode: value => value.slice(prefix.length),
  encode: (value: string) => prefix + value,
})

it.each(["like", "ilike"] as const)(
  "%s sends a string pattern as it is and a pattern parameter with its type",
  operator => {
    const name = param(encodedText.withOperators(textOperators), "a")

    expect(from(user).where(name[operator]("a%")).toSQL().parameters).toEqual(["prefix:a", "a%"])
    expect(
      from(user)
        .where(name[operator](param(encodedText, "a%")))
        .toSQL().parameters,
    ).toEqual(["prefix:a", "prefix:a%"])
  },
)

it("a custom pattern operator sends a string pattern as it is", () => {
  const similarTo = defineGenericOperator<PatternSignature, AnyExpression<string | null>>(
    (self, pattern) => sql(t.boolean)`${self} SIMILAR TO ${pattern}`,
  )
  const name = param(encodedText.withOperators({ similarTo }), "a")

  expect(from(user).where(name.similarTo("a%")).toSQL()).toMatchObject({
    text: 'SELECT FROM "user" AS "user" WHERE ($1::text) SIMILAR TO $2',
    parameters: ["prefix:a", "a%"],
  })
})
