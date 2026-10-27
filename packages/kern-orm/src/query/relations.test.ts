import { describe, expect, it } from "bun:test"

import { describePostgres } from "../../testing/postgres"
import { createRecordingDriver } from "../../testing/recording-driver"
import { createDatabase } from "../execution/database"
import { and, or } from "../expression/predicates"
import { many, one } from "../schema/relation"
import { defineSchema } from "../schema/schema"
import { defineTable } from "../table/table"
import { defineType } from "../type/type"
import * as t from "../types"

import { defineHelper } from "./helper"
import { from, SelectQuery } from "./select"

/** Integer of a rating in stars, decoded into an object, as a custom scalar of nested records. */
const rating = defineType({ sqlType: "integer" }).transform({
  decode: text => ({ stars: Number(text) }),
  encode: (value: { stars: number }) => String(value.stars),
})

const form = defineTable("form", {
  id: t.integer.primaryKey(),
  name: t.text,
})

const field = defineTable("form_field", {
  id: t.integer.primaryKey(),
  formId: t.integer.columnName("form_id"),
  label: t.text.nullable(),
  weight: rating,
})

const option = defineTable("field_option", {
  id: t.integer,
  fieldId: t.integer.columnName("field_id"),
  value: t.text,
})

const author = defineTable("author", {
  id: t.integer.primaryKey(),
  email: t.text.unique(),
})

const biography = defineTable("biography", {
  id: t.integer.primaryKey(),
  authorId: t.integer.columnName("author_id").unique(),
  authorEmail: t.text.columnName("author_email"),
  text: t.text,
})

const schema = defineSchema({ form, field, option, author, biography }).$relations({
  form: {
    fields: many(field, { from: "id", to: "formId" }),
  },
  field: {
    form: one(form, { from: "formId", to: "id" }),
    options: many(option, { from: "id", to: "fieldId" }),
  },
  option: {
    // Not required, as without a foreign key: an option may refer to a missing field.
    field: one(field, { from: "fieldId", to: "id", required: false }),
  },
  author: {
    // Not required: the key of an author matches at most one biography, which may be missing.
    biography: one(biography, { from: "id", to: "authorId" }),
  },
  biography: {
    author: one(author, { from: "authorEmail", to: "email" }),
  },
})

describe("relation queries", () => {
  it("select the records of a relation of the row of the parent, comparing the keys with SQL =", () => {
    const query = schema.form.select(form => ({
      fields: form.fields.select("label"),
    }))

    expect(query.toSQL().text).toBe(
      `SELECT (SELECT coalesce(json_agg(json_build_array(CASE WHEN "subquery"."label" IS NOT DISTINCT FROM NULL THEN NULL ELSE format('%s', "subquery"."label") END)), '[]'::json) AS "rows" FROM (SELECT "form_field"."label" AS "label" FROM "form_field" AS "form_field" WHERE "form_field"."form_id" = "form"."id") AS "subquery") AS "fields" FROM "form" AS "form"`,
    )
  })

  it("select the record of a relation one as one packed row without a limit, also after take", () => {
    const query = schema.field.select(field => ({
      form: field.form.select("name"),
    }))
    const taken = schema.field.select(field => ({
      form: field.form.select("name").take(),
    }))

    expect(query.toSQL().text).toBe(
      `SELECT (SELECT json_build_array(CASE WHEN "subquery"."name" IS NOT DISTINCT FROM NULL THEN NULL ELSE format('%s', "subquery"."name") END) AS "rows" FROM (SELECT "form"."name" AS "name" FROM "form" AS "form" WHERE "form"."id" = "form_field"."form_id") AS "subquery") AS "form" FROM "form_field" AS "form_field"`,
    )
    expect(taken.toSQL().text).toBe(query.toSQL().text)
  })

  it("reject the pagination of a relation one", () => {
    expect(() =>
      schema.field.select(field => ({
        // @ts-expect-error A relation one has no pagination.
        form: field.form.limit(1),
      })),
    ).toThrow(/^limit applies only to a query of many rows$/)
  })

  it("compare the columns of a composite key in order, combined with AND", () => {
    const owned = defineTable("owned", {
      id: t.integer,
      ownerId: t.integer,
    })
    const item = defineTable("item", {
      ownedId: t.integer,
      ownerId: t.integer,
    })
    const items = defineSchema({ owned, item }).$relations({
      owned: {
        items: many(item, { from: ["id", "ownerId"], to: ["ownedId", "ownerId"] }),
      },
    })

    expect(
      items.owned
        .select(owned => ({
          items: owned.items,
        }))
        .toSQL().text,
    ).toContain('WHERE "item"."ownedId" = "owned"."id" AND "item"."ownerId" = "owned"."ownerId"')
  })

  it("compare the keys with SQL = even when the type of a key replaces eq", () => {
    const code = t.integer.withOperators({
      eq: () => {
        throw new Error("The relation filter called eq")
      },
    })
    const owner = defineTable("owner", {
      code,
    })
    const pet = defineTable("pet", {
      ownerCode: code,
    })
    const pets = defineSchema({ owner, pet }).$relations({
      owner: {
        pets: many(pet, { from: "code", to: "ownerCode" }),
      },
    })

    expect(
      pets.owner
        .select(owner => ({
          pets: owner.pets,
        }))
        .toSQL().text,
    ).toContain('WHERE "pet"."ownerCode" = "owner"."code"')
  })

  it("keep a filter with OR apart from the correlation", () => {
    const query = schema.form.select(form => ({
      fields: form.fields.where(or({ label: "Name" }, { label: "Email" })),
    }))

    expect(query.toSQL()).toMatchObject({
      text: expect.stringContaining(
        'WHERE "form_field"."form_id" = "form"."id" AND ("form_field"."label" = $1 OR "form_field"."label" = $2)',
      ),
      parameters: ["Name", "Email"],
    })
  })

  it("start a new occurrence of the target table on each access", () => {
    const query = schema.form.select(form => ({
      labels: form.fields.pluck("label"),
      fields: form.fields,
    }))

    expect(query.toSQL().text).toContain('FROM "form_field" AS "form_field_2"')
  })

  it("have the relations of their table in the same schema", () => {
    const query = schema.form.select(form => ({
      fields: form.fields.select(field => ({
        options: field.options.pluck("value"),
      })),
    }))

    expect(query.toSQL().text).toContain(
      'FROM "field_option" AS "field_option" WHERE "field_option"."field_id" = "form_field"."id"',
    )
  })

  it("give the relations of a table, and no relations to a query of from", () => {
    let fieldRefs: object | undefined
    let tableRefs: object | undefined
    schema.field.select(columns => {
      fieldRefs = columns
      return {}
    })
    from(form).select(columns => {
      tableRefs = columns
      return {}
    })

    expect(Reflect.get(fieldRefs!, "options")).toBeInstanceOf(SelectQuery)
    expect(Reflect.get(fieldRefs!, "form")).toBeInstanceOf(SelectQuery)
    expect(Reflect.get(tableRefs!, "fields")).toBeUndefined()
  })

  it("are selected with the columns when the references are returned or spread", () => {
    const returned = schema.field.select(field => field)
    const spread = schema.field.select(field => ({ ...field }))

    expect(returned.toSQL().text).toBe(spread.toSQL().text)
    expect(returned.toSQL().text).toStartWith(
      'SELECT "form_field"."id" AS "id", "form_field"."form_id" AS "formId", "form_field"."label" AS "label", "form_field"."weight" AS "weight", (SELECT json_build_array() AS "rows" FROM (SELECT FROM "form" AS "form" WHERE "form"."id" = "form_field"."form_id") AS "subquery") AS "form", (SELECT coalesce(json_agg(json_build_array()), \'[]\'::json) AS "rows" FROM (SELECT FROM "field_option" AS "field_option" WHERE "field_option"."field_id" = "form_field"."id") AS "subquery_2") AS "options"',
    )
  })

  it("build without statements and execute in one statement", async () => {
    const { driver, statements } = createRecordingDriver({ respond: () => ({ rows: [["[]"]] }) })
    const db = createDatabase({ driver }).bind(schema)

    const query = db.form.select(form => ({
      fields: form.fields.select(field => ({
        options: field.options,
      })),
    }))
    expect(statements).toEqual([])

    expect(await query).toEqual([{ fields: [] }])
    expect(statements).toHaveLength(1)
  })
})

describePostgres("in PostgreSQL", ({ database, testTransaction, useTestFixture, runStatement }) => {
  useTestFixture(async () => {
    await runStatement("CREATE SCHEMA tenant_1")
    await runStatement("CREATE TABLE tenant_1.form (id integer, name text)")
    await runStatement(
      "CREATE TABLE tenant_1.form_field (id integer, form_id integer, label text, weight integer)",
    )
    await runStatement(
      "CREATE TABLE tenant_1.field_option (id integer, field_id integer, value text)",
    )
    await runStatement(
      "INSERT INTO tenant_1.form VALUES (1, 'Survey'), (2, 'Feedback'), (3, 'Empty')",
    )
    await runStatement(
      "INSERT INTO tenant_1.form_field VALUES (1, 1, 'Name', 3), (2, 1, 'Email', 1), (3, 1, NULL, 2), (4, 2, 'Comment', 5)",
    )
    await runStatement(
      "INSERT INTO tenant_1.field_option VALUES (1, 1, 'First'), (2, 1, 'Last'), (3, 4, 'Short')",
    )
    await runStatement("CREATE TABLE tenant_1.author (id integer, email text)")
    await runStatement(
      "CREATE TABLE tenant_1.biography (id integer, author_id integer, author_email text, text text)",
    )
    await runStatement(
      "INSERT INTO tenant_1.author VALUES (1, 'ada@example.com'), (2, 'alan@example.com')",
    )
    await runStatement("INSERT INTO tenant_1.biography VALUES (1, 1, 'ada@example.com', 'Ada')")
  })

  const db = database.bind(schema, { schemaName: "tenant_1" })
  const forms = db.form.select("id").select(form => ({
    fields: form.fields.where(or({ label: "Name" }, { label: "Comment" })).select(field => ({
      label: field.label,
      weight: field.weight,
      options: field.options.pluck("value"),
    })),
    unlabeled: form.fields.where({ label: null }).pluck("id").take().optional(),
  }))

  it("selects the records of relations in the PostgreSQL schema of the Db, keeping parents without them", async () => {
    const rows = await testTransaction(() => db.$transaction(async () => await forms))

    expect(rows.toSorted((a, b) => a.id - b.id)).toEqual([
      {
        id: 1,
        fields: [
          {
            label: "Name",
            weight: { stars: 3 },
            options: expect.arrayContaining(["First", "Last"]),
          },
        ],
        unlabeled: 3,
      },
      {
        id: 2,
        fields: [{ label: "Comment", weight: { stars: 5 }, options: ["Short"] }],
        unlabeled: undefined,
      },
      { id: 3, fields: [], unlabeled: undefined },
    ])
  })

  it("tells a missing related row from a NULL value at any depth and through a helper", async () => {
    const last = defineHelper(schema.field, field =>
      field.orderBy({ id: "desc" }).take().optional(),
    )
    const labels = db.form.orderBy("id").select(form => ({
      id: form.id,
      lastLabel: form.fields.orderBy({ id: "desc" }).get("label").optional(),
      lastHelped: form.fields.use(last).pluck("label"),
      fields: form.fields.orderBy("id").select(field => ({
        id: field.id,
        nextLabel: db.field
          .where(next => and(next.formId.eq(field.formId), next.id.gt(field.id)))
          .orderBy("id")
          .get("label")
          .optional(),
      })),
    }))

    expect(await testTransaction(async () => await labels)).toStrictEqual([
      {
        id: 1,
        lastLabel: null,
        lastHelped: null,
        fields: [
          { id: 1, nextLabel: "Email" },
          { id: 2, nextLabel: null },
          { id: 3, nextLabel: undefined },
        ],
      },
      {
        id: 2,
        lastLabel: "Comment",
        lastHelped: "Comment",
        fields: [{ id: 4, nextLabel: undefined }],
      },
      { id: 3, lastLabel: undefined, lastHelped: undefined, fields: [] },
    ])
  })

  it("selects the record of a relation one for each row, telling a record of NULL values from a missing one", async () => {
    const options = db.option.orderBy("id").select(option => ({
      id: option.id,
      field: option.field.select("label"),
    }))

    const rows = await testTransaction(async () => {
      await runStatement(
        "INSERT INTO tenant_1.field_option VALUES (4, 3, 'Other'), (5, 9, 'Orphan')",
      )
      return await options
    })

    expect(rows).toStrictEqual([
      { id: 1, field: { label: "Name" } },
      { id: 2, field: { label: "Name" } },
      { id: 3, field: { label: "Comment" } },
      { id: 4, field: { label: null } },
      { id: 5, field: null },
    ])
  })

  it("selects the record of a relation one by a unique key, and null where the columns from are a key of their table", async () => {
    const authors = db.author.orderBy("id").select(author => ({
      id: author.id,
      biography: author.biography.select("text"),
    }))
    const biographies = db.biography.select(biography => ({
      author: biography.author.select("id"),
    }))

    const rows = await testTransaction(async () => [await authors, await biographies] as const)

    expect(rows).toStrictEqual([
      [
        { id: 1, biography: { text: "Ada" } },
        { id: 2, biography: null },
      ],
      [{ author: { id: 1 } }],
    ])
  })

  it("rejects a missing record of a required relation with the path of its field", async () => {
    const options = db.option.select(option => ({
      field: option.field.select(field => ({
        form: field.form.select("name"),
      })),
    }))

    await testTransaction(async () => {
      await runStatement("INSERT INTO tenant_1.form_field VALUES (5, 9, 'Orphan', 1)")
      await runStatement("INSERT INTO tenant_1.field_option VALUES (4, 5, 'Orphan')")
      await expect(Promise.resolve(options)).rejects.toThrow(
        'Cannot decode result field "field.form": Nested query of one row returned no rows',
      )
    })
  })

  it("rejects several records of a relation one", async () => {
    const fields = db.field.select(field => ({
      form: field.form.select("name"),
    }))

    await testTransaction(async () => {
      await runStatement("INSERT INTO tenant_1.form VALUES (1, 'Copy')")
      await expect(Promise.resolve(fields)).rejects.toMatchObject({ code: "21000" })
    })
  })

  it("nests relations one and many in each other", async () => {
    const fields = db.field.where({ id: 4 }).select(field => ({
      form: field.form.select(form => ({
        name: form.name,
        fields: form.fields.select(sibling => ({
          id: sibling.id,
          form: sibling.form.get("name"),
        })),
      })),
    }))

    expect(await testTransaction(async () => await fields)).toStrictEqual([
      { form: { name: "Feedback", fields: [{ id: 4, form: "Feedback" }] } },
    ])
  })

  it("sorts and paginates the records of a relation for each parent", async () => {
    const paginated = db.form.orderBy({ id: "desc" }).select(form => ({
      id: form.id,
      heaviest: form.fields.orderBy({ weight: "desc" }).limit(2).pluck("id"),
      labels: form.fields.orderBy({ label: "asc nulls first" }).offset(1).pluck("label"),
      second: form.fields.orderBy("id").offset(1).pluck("id").take().optional(),
    }))

    expect(await testTransaction(async () => await paginated)).toEqual([
      { id: 3, heaviest: [], labels: [], second: undefined },
      { id: 2, heaviest: [4], labels: [], second: undefined },
      { id: 1, heaviest: [1, 3], labels: ["Email", "Name"], second: 2 },
    ])
  })
})
