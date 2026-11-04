import { expectTypeOf, test } from "bun:test"

import { defineFilter } from "../query/filters"
import { from } from "../query/select"
import { defineTable } from "../table/table"
import * as t from "../types"

import type { Expression } from "./expression"
import type { Predicate } from "./predicates"
import { and, not, or } from "./predicates"
import { param, sql } from "./sql"

const form = defineTable("form", {
  name: t.text,
  published: t.boolean,
  hint: t.text.nullable(),
})

test("and, or, and not combine objects of column values and expressions", () => {
  from(form).where(columns => or({ published: true }, columns.name.in(["Survey"])))
  from(form).where(or({ published: true }, and({ hint: null }, not({ name: "Draft" }))))
  from(form).where(not(and({ published: true }, or({ hint: null }, { name: "Draft" }))))
})

test("objects of column values are checked against the table", () => {
  // @ts-expect-error Object keys are columns of the table.
  from(form).where(columns => or({ publshed: true }, columns.name.eq("Survey")))

  // @ts-expect-error Object values are typed by the column.
  from(form).where(or({ published: "yes" }, { name: "Survey" }))

  // @ts-expect-error Object keys of nested combinations are columns of the table.
  from(form).where(not(and({ published: true }, { nmae: "Draft" })))
})

test("and, or, and not are Boolean expressions without objects outside `where`", () => {
  const prebuilt = or(and(), not(and()))
  const predicate: Predicate = prebuilt
  from(form).where(predicate)
  from(form).where(sql<boolean>`${prebuilt} OR TRUE`)
})

test("an instance of a class is an object of column values by its fields", () => {
  class PublishedFilter {
    published = true
  }

  from(form).where(new PublishedFilter())
  // @ts-expect-error A date has none of the columns of the table.
  from(form).where(new Date())
})

test("objects of column values need a table", () => {
  // @ts-expect-error An object of column values outside `where` needs the table.
  or({ anything: 1 })
})

test("filters of `defineFilter` compose", () => {
  const condition = defineFilter(form, or({ published: true }, { hint: null }))
  const filter = defineFilter(form, columns => columns.name.eq("Draft"))
  const negated = not(condition)
  const combined = and(condition, { name: "Draft" })
  from(form)
    .where(negated)
    .where(combined)
    .where(columns => or(filter(columns), condition))

  // @ts-expect-error Object keys combined with a condition are columns of its table.
  and(condition, { nmae: "Draft" })
})

test("and, or, and not are nullable when any operand is", () => {
  const value = param(t.integer, 1)
  const nullable = param(t.integer.nullable(), null)
  const required = value.eq(1)
  const optional = nullable.eq(1)
  expectTypeOf(and()).toEqualTypeOf<Expression<boolean>>()
  expectTypeOf(or()).toEqualTypeOf<Expression<boolean>>()
  expectTypeOf(and(required, required)).toEqualTypeOf<Expression<boolean>>()
  expectTypeOf(or(required, required)).toEqualTypeOf<Expression<boolean>>()
  expectTypeOf(not(required)).toEqualTypeOf<Expression<boolean>>()
  expectTypeOf(and(required, optional)).toEqualTypeOf<Expression<boolean | null>>()
  expectTypeOf(or(optional, required)).toEqualTypeOf<Expression<boolean | null>>()
  expectTypeOf(not(optional)).toEqualTypeOf<Expression<boolean | null>>()
  expectTypeOf(not(or(required, and(required, optional)))).toEqualTypeOf<
    Expression<boolean | null>
  >()
  expectTypeOf(and(optional, or())).toEqualTypeOf<Expression<boolean | null>>()
  const predicates: Predicate[] = []
  expectTypeOf(and(...predicates)).toEqualTypeOf<Expression<boolean | null>>()
  expectTypeOf(or(...predicates)).toEqualTypeOf<Expression<boolean | null>>()
  // @ts-expect-error A nullable predicate does not become non-nullable from the expected result type.
  const result: Expression<boolean> = and(optional)
  void result
})

test("and, or, and not take a query of one Boolean value, nullable as its value or without its row", () => {
  const exists = from(form).exists()
  const some = from(form).some("published")
  expectTypeOf(not(exists)).toEqualTypeOf<Expression<boolean>>()
  expectTypeOf(and(exists, some)).toEqualTypeOf<Expression<boolean | null>>()
  expectTypeOf(or(from(form).get("published"))).toEqualTypeOf<Expression<boolean | null>>()
  expectTypeOf(not(from(form).get("published").optional())).toEqualTypeOf<
    Expression<boolean | null>
  >()
  from(form).where(exists)
  from(form).where(columns => or({ published: true }, not(exists), columns.name.eq("Survey")))
  from(form).where(and(exists, { hint: null }))

  // @ts-expect-error A query of records is not a condition.
  not(from(form))
  // @ts-expect-error A query of an array of values is not a condition.
  from(form).where(from(form).pluck("published"))
  // @ts-expect-error A query of a value other than a Boolean is not a condition.
  or(from(form).get("name"))
  // @ts-expect-error A copy of a query is not a query.
  and({ ...exists })
  // @ts-expect-error A copy of a query is not a query.
  from(form).where({ ...exists })
})

test("nullable predicates remain valid with an explicit table condition type", () => {
  const nullable = param(t.integer.nullable(), null)
  and<{ id?: number }>({ id: 1 }, nullable.eq(1))
  or<{ id?: number }>(nullable.eq(1), { id: 1 })
  not<{ id?: number }>(nullable.eq(1))
})
