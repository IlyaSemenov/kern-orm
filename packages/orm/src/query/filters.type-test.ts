import { describe, test } from "bun:test"

import { not, or } from "../expression/predicates"
import { one } from "../schema/relation"
import { defineSchema } from "../schema/schema"
import { defineTable } from "../table/table"
import * as t from "../types"

import type { WhereCondition, WhereFilter } from "./filters"
import { defineHelper } from "./helper"
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

test("a function generic over its query keeps its type", () => {
  const forms = from(form)

  function filterAll<Q extends typeof forms>(query: Q): Q {
    return query.where({})
  }
  function filterBy<Q extends typeof forms>(
    query: Q,
    filter: WhereFilter<Q["types"]["table"], Q["types"]["schema"]>,
  ): Q {
    return query.where(filter)
  }

  filterAll(forms)
  filterBy(forms, { published: true })
})

describe("a callback that returns literals of the values of a column", () => {
  const article = defineTable("article", {
    id: t.uuid.primaryKey(),
    status: t.enum("article_status", ["draft", "live"]),
    history: t.array(t.enum("article_status", ["draft", "live"])),
  })
  const comment = defineTable("comment", {
    id: t.uuid.primaryKey(),
    articleId: t.uuid,
  })
  const blog = defineSchema({ article, comment }).$relations({
    comment: {
      article: one(article, { from: "articleId", to: "id", required: true }),
    },
  })
  const published = true as boolean

  test("is taken with and without parameters", () => {
    blog.article.where(() => ({ status: "live" }))
    blog.article.where(() => ({ status: published ? "live" : "draft" }))
    blog.article.where(() => ({ history: ["draft", "live"] }))
    blog.article.where(columns => ({ status: "live", id: columns.id }))
    blog.article.where(() => or({ status: "live" }, { status: "draft" }))
  })

  test("is taken by a query of one row, a required relation, and a helper", () => {
    blog.article.find("article-id").where(() => ({ status: "live" }))
    blog.comment.select(columns => ({
      article: columns.article.where(article => ({ status: "live", id: article.id })),
    }))
    defineHelper(blog.article, query =>
      query.where(columns => ({ status: "live", id: columns.id })),
    )
  })

  test("needs a parameter on a query that the overload that keeps its state rejects", () => {
    blog.comment.select(columns => ({
      // @ts-expect-error The rejected overload types the callback without its columns, for every overload.
      article: columns.article.where(() => ({ status: "live" })),
    }))
    defineHelper(blog.article, query =>
      // @ts-expect-error The rejected overload types the callback without its columns, for every overload.
      query.where(() => ({ status: "live" })),
    )
  })

  test("rejects a literal of other values", () => {
    // @ts-expect-error A literal of other values is rejected.
    blog.article.where(() => ({ status: "archived" }))
    // @ts-expect-error A literal of other values is rejected.
    blog.article.where(columns => ({ status: "archived", id: columns.id }))
  })
})
