import { describe, expect, it } from "bun:test"

import { createRecordingDriver } from "../../testing/recording-driver"
import { createDatabase } from "../execution/database"
import { sql } from "../expression/sql"
import { defineSchema } from "../schema/schema"
import { defineTable } from "../table/table"
import * as t from "../types"

import type { ColumnRefs } from "./column-refs"
import { noContext } from "./column-refs"
import { mergeProjections, projectValue } from "./projections"
import { from } from "./select"

const post = defineTable("post", {
  id: t.uuid,
  title: t.text,
  createdAt: t.timestamptz.columnName("created_at"),
})
const source = from(post).node.from

type PostColumns = ColumnRefs<typeof post>

describe("mergeProjections", () => {
  it("projects columns under their keys with the types of the columns", () => {
    expect(mergeProjections([], source, ["id", "createdAt"], noContext)).toEqual([
      { key: "id", expression: { kind: "column", source, key: "id" }, type: t.uuid },
      {
        key: "createdAt",
        expression: { kind: "column", source, key: "createdAt" },
        type: t.timestamptz,
      },
    ])
  })

  it("projects all columns with *", () => {
    expect(
      mergeProjections([], source, ["*"], noContext).map(projection => projection.key),
    ).toEqual(["id", "title", "createdAt"])
  })

  it("projects expressions under their keys with the types of the expressions", () => {
    const projections = mergeProjections(
      [],
      source,
      [
        (columns: PostColumns) => ({
          title: columns.title,
          heading: columns.title,
          isDraft: columns.title.ilike("draft%"),
          upper: sql(t.text)`upper(${columns.title})`,
        }),
      ],
      noContext,
    )

    expect(projections).toMatchObject([
      { key: "title", type: t.text },
      { key: "heading", type: t.text },
      { key: "isDraft", type: t.boolean },
      { key: "upper", type: t.text },
    ])
  })

  it("selects the rows of a query under its key with the Db it is bound to", () => {
    const comments = from(post).pluck("title")
    const db = createDatabase({ driver: createRecordingDriver().driver }).bind(
      defineSchema({ post }),
    )

    expect(
      mergeProjections(
        [],
        source,
        [
          () => ({
            comments,
            posts: db.post,
          }),
        ],
        noContext,
      ),
    ).toEqual([
      { key: "comments", query: comments.node, db: undefined },
      { key: "posts", query: db.post.node, db },
    ])
  })

  it("appends to the given projections without changing them", () => {
    const given = mergeProjections([], source, ["id"], noContext)

    expect(
      mergeProjections(given, source, ["title"], noContext).map(projection => projection.key),
    ).toEqual(["id", "title"])
    expect(given.map(projection => projection.key)).toEqual(["id"])
  })

  it("selects a repeated column once, within a call and across calls", () => {
    const given = mergeProjections([], source, ["id"], noContext)

    expect(mergeProjections([], source, ["id", "id"], noContext)).toEqual(given)
    expect(mergeProjections(given, source, ["id"], noContext)).toEqual(given)
  })

  it("replaces an expression and its type without moving the field or changing the input", () => {
    const given = mergeProjections([], source, ["id", "title"], noContext)
    const selected = mergeProjections(
      given,
      source,
      [
        (columns: PostColumns) => ({
          id: sql(t.integer)`1`,
          heading: columns.title,
        }),
      ],
      noContext,
    )

    expect(selected).toMatchObject([
      { key: "id", type: t.integer },
      { key: "title", type: t.text },
      { key: "heading", type: t.text },
    ])
    expect(selected[1]).toBe(given[1])
    expect(given[0]).toEqual({
      key: "id",
      expression: { kind: "column", source, key: "id" },
      type: t.uuid,
    })
    expect(given).toHaveLength(2)
  })

  it("replaces aliases under column keys with * and keeps other aliases", () => {
    const given = mergeProjections(
      [],
      source,
      [
        (columns: PostColumns) => ({
          id: columns.title,
          heading: columns.title,
        }),
      ],
      noContext,
    )
    const selected = mergeProjections(given, source, ["*"], noContext)

    expect(selected.map(projection => projection.key)).toEqual([
      "id",
      "heading",
      "title",
      "createdAt",
    ])
    expect(selected[0]).toEqual({
      key: "id",
      expression: { kind: "column", source, key: "id" },
      type: t.uuid,
    })
    expect(selected[1]).toBe(given[1])
  })

  it("replaces numeric and string spellings of the same key", () => {
    const given = mergeProjections(
      [],
      source,
      [
        (columns: PostColumns) => ({
          0: columns.id,
        }),
      ],
      noContext,
    )
    const selected = mergeProjections(
      given,
      source,
      [
        () => ({
          "0": sql(t.integer)`1`,
        }),
      ],
      noContext,
    )

    expect(selected).toHaveLength(1)
    expect(selected[0]).toMatchObject({ key: "0", type: t.integer })
  })

  it("keeps a field absent from the callback result", () => {
    const given = mergeProjections([], source, ["id"], noContext)

    expect(mergeProjections(given, source, [() => ({})], noContext)).toEqual(given)
  })

  it("rejects a key that a record cannot have", () => {
    expect(() =>
      mergeProjections(
        [],
        source,
        [
          (columns: PostColumns) => ({
            ["__proto__"]: columns.id,
          }),
        ],
        noContext,
      ),
    ).toThrow('Field "__proto__" cannot be selected')
    expect(() =>
      mergeProjections(
        [],
        source,
        [
          (columns: PostColumns) => ({
            [Symbol("id")]: columns.id,
          }),
        ],
        noContext,
      ),
    ).toThrow("A selected field must have a string key")
  })

  it("rejects an unknown column and a field that is neither an expression nor a query", () => {
    expect(() => mergeProjections([], source, ["missing"], noContext)).toThrow(
      'Unknown column "missing" of table "post"',
    )
    expect(() =>
      mergeProjections(
        [],
        source,
        [
          () => ({
            id: "id",
          }),
        ],
        noContext,
      ),
    ).toThrow('Selected field "id" must be an expression or a query')
  })

  it("rejects an expression without a type", () => {
    expect(() =>
      mergeProjections(
        [],
        source,
        [
          () => ({
            length: sql<number>`length(title)`,
          }),
        ],
        noContext,
      ),
    ).toThrow('Selected field "length" has no type to decode its values')
  })
})

describe("projectValue", () => {
  it("projects a column under its key with the type of the column", () => {
    expect(projectValue(source, "createdAt", "get")).toEqual({
      key: "createdAt",
      expression: { kind: "column", source, key: "createdAt" },
      type: t.timestamptz,
    })
  })

  it("projects an expression with the type of the expression", () => {
    const projection = projectValue(
      source,
      (columns: PostColumns) => columns.title.ilike("draft%"),
      "get",
    )

    expect(projection).toMatchObject({ key: "value", type: t.boolean })
  })

  it("rejects an unknown column and a callback that returns no expression", () => {
    expect(() => projectValue(source, "missing", "get")).toThrow(
      'Unknown column "missing" of table "post"',
    )
    expect(() => projectValue(source, () => "id", "pluck")).toThrow(
      "The callback of pluck must return an expression",
    )
  })

  it("rejects an expression without a type", () => {
    expect(() => projectValue(source, () => sql<number>`length(title)`, "get")).toThrow(
      "The expression of get has no type to decode its values",
    )
  })
})
