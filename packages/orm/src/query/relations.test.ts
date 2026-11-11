import { describe, expect, it } from "bun:test"

import { createRecordingDriver } from "@kern-orm/test-harness/recording-driver"
import { createDatabase, NotFoundError } from "kern-db"

import { describePostgres } from "../../testing/postgres"
import { bindSchema } from "../execution/db"
import { and, not, or } from "../expression/predicates"
import { sql } from "../expression/sql"
import { RequiredRelationError } from "../result/result"
import { many, one } from "../schema/relation"
import { defineSchema } from "../schema/schema"
import { defineTable } from "../table/table"
import { defineType } from "../type/type"
import * as t from "../types"

import { defineHelper } from "./helper"
import type { NestedSelectionNode } from "./node"
import { desc } from "./order"
import type { AnySelectQuery } from "./select"
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
    form: one(form, { from: "formId", to: "id", required: true }),
    options: many(option, { from: "id", to: "fieldId" }),
  },
  option: {
    // Not required, as without a foreign key: an option may refer to a missing field.
    field: one(field, { from: "fieldId", to: "id" }),
  },
  author: {
    // Not required: an author may have no biography.
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

  it("keep the rows mode of a relation to a singleton table, whose query upsert rejects", () => {
    const license = defineTable(
      "license",
      {
        id: t.integer.primaryKey(),
        ownerId: t.integer.columnName("owner_id"),
      },
      { singleton: true },
    )
    const owner = defineTable("owner", {
      id: t.integer.primaryKey(),
      licenseId: t.integer.columnName("license_id"),
    })
    const licensed = defineSchema({ owner, license }).$relations({
      owner: {
        licenses: many(license, { from: "id", to: "ownerId" }),
        license: one(license, { from: "licenseId", to: "id" }),
        requiredLicense: one(license, { from: "licenseId", to: "id", required: true }),
      },
    })
    const relations: AnySelectQuery[] = []
    licensed.owner.select(columns => {
      relations.push(columns.licenses, columns.license, columns.requiredLicense)
      return {}
    })

    expect(relations.map(relation => relation.node.rows)).toEqual(["many", "nullable", "one"])
    for (const relation of relations) {
      expect(() => relation.upsert({ ownerId: 1 })).toThrow(
        /^upsert applies only to a query of a singleton table or right after find or findBy/,
      )
    }
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

  it("correlate a relation of a table to itself with the row of the parent, each through its own occurrence of the table", () => {
    const category = defineTable("category", {
      id: t.integer.primaryKey(),
      parentId: t.integer.nullable().columnName("parent_id"),
    })
    const tree = defineSchema({ category }).$relations({
      category: {
        parent: one(category, { from: "parentId", to: "id" }),
        children: many(category, { from: "id", to: "parentId" }),
      },
    })

    const text = tree.category
      .select(category => ({
        parent: category.parent.get("id"),
        children: category.children.select(child => ({
          children: child.children.pluck("id"),
        })),
      }))
      .toSQL().text

    expect(text).toContain(
      'FROM "category" AS "category_2" WHERE "category_2"."id" = "category"."parent_id"',
    )
    expect(text).toContain(
      'FROM "category" AS "category_3" WHERE "category_3"."parent_id" = "category"."id"',
    )
    expect(text).toContain(
      'FROM "category" AS "category_4" WHERE "category_4"."parent_id" = "category_3"."id"',
    )
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

  // Orchid ORM let a user OR bypass the relation condition: https://github.com/romeerez/orchid-orm/issues/845
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

  it("find a record by its key beside the correlation", () => {
    const query = schema.form.select(form => ({
      field: form.fields.find(1).select("label"),
    }))

    expect(query.toSQL()).toMatchObject({
      text: expect.stringContaining(
        'WHERE "form_field"."form_id" = "form"."id" AND "form_field"."id" = $1)',
      ),
      parameters: ["1"],
    })
  })

  it("make the record of a required relation nullable after a filter, and its value optional, unless required is called before or after the filter", () => {
    const query = schema.field.select(field => ({
      form: field.form,
      filtered: field.form.where({ name: "Survey" }),
      found: field.form.find(1),
      foundBy: field.form.findBy({ id: 1 }),
      nameAfterFilter: field.form.where({ name: "Survey" }).get("name"),
      nameBeforeFilter: field.form.get("name").where({ name: "Survey" }),
      namesAfterFilter: field.form.where({ name: "Survey" }).pluck("name"),
      namesBeforeFilter: field.form.pluck("name").where({ name: "Survey" }),
      required: field.form.where({ name: "Survey" }).required(),
      requiredBeforeFilter: field.form.required().where({ name: "Survey" }),
    }))
    const rows = Object.fromEntries(
      query.node.projections.map(field => [field.key, (field as NestedSelectionNode).query.rows]),
    )

    expect(rows).toEqual({
      form: "one",
      filtered: "nullable",
      found: "nullable",
      foundBy: "nullable",
      nameAfterFilter: "optional",
      nameBeforeFilter: "optional",
      namesAfterFilter: "optional",
      namesBeforeFilter: "optional",
      required: "one",
      requiredBeforeFilter: "one",
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

  it("give the relations of a table to the callbacks of select and where, and no relations to a query of from", () => {
    let fieldRefs: object | undefined
    let filterRefs: object | undefined
    let tableRefs: object | undefined
    schema.field.select(columns => {
      fieldRefs = columns
      return {}
    })
    schema.field.where(columns => {
      filterRefs = columns
      return {}
    })
    from(form).where(columns => {
      tableRefs = columns
      return {}
    })

    expect(Reflect.get(fieldRefs!, "options")).toBeInstanceOf(SelectQuery)
    expect(Reflect.get(fieldRefs!, "form")).toBeInstanceOf(SelectQuery)
    expect(Reflect.get(filterRefs!, "options")).toBeInstanceOf(SelectQuery)
    expect(Reflect.get(tableRefs!, "fields")).toBeUndefined()
  })

  it("filter the parent by whether records of a relation exist, correlated with its row", () => {
    const query = schema.form.where(form =>
      or(form.fields.where({ label: "Email" }).exists(), not(form.fields.exists())),
    )

    expect(query.toSQL()).toEqual({
      text: 'SELECT FROM "form" AS "form" WHERE EXISTS (SELECT FROM "form_field" AS "form_field" WHERE "form_field"."form_id" = "form"."id" AND "form_field"."label" = $1) OR NOT EXISTS (SELECT FROM "form_field" AS "form_field_2" WHERE "form_field_2"."form_id" = "form"."id")',
      parameters: ["Email"],
    })
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
    const db = bindSchema(schema, createDatabase({ driver }))

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

describe("relation queries in the callbacks of values", () => {
  it("are scalar subqueries of get and pluck, correlated with the row, or EXISTS of a query of exists", () => {
    expect(schema.form.pluck(form => form.fields.count()).toSQL().text).toBe(
      'SELECT (SELECT count(*) AS "count" FROM "form_field" AS "form_field" WHERE "form_field"."form_id" = "form"."id") AS "value" FROM "form" AS "form"',
    )
    expect(schema.form.pluck(form => form.fields.exists()).toSQL().text).toBe(
      'SELECT EXISTS (SELECT FROM "form_field" AS "form_field" WHERE "form_field"."form_id" = "form"."id") AS "value" FROM "form" AS "form"',
    )
    expect(
      schema.field
        .where({ id: 1 })
        .get(field => field.form.get("name"))
        .toSQL().text,
    ).toBe(
      'SELECT (SELECT "form"."name" AS "name" FROM "form" AS "form" WHERE "form"."id" = "form_field"."form_id") AS "value" FROM "form_field" AS "form_field" WHERE "form_field"."id" = $1 LIMIT 1',
    )
  })

  it("are read by an aggregate from a derived source of the rows that it aggregates", () => {
    expect(schema.form.max(form => form.fields.count()).toSQL().text).toBe(
      'SELECT max("subquery"."value") AS "max" FROM (SELECT (SELECT count(*) AS "count" FROM "form_field" AS "form_field" WHERE "form_field"."form_id" = "form"."id") AS "value" FROM "form" AS "form") AS "subquery"',
    )
    expect(
      schema.field
        .orderBy({ id: "desc" })
        .stringAgg(field => field.form.get("name"), ",")
        .toSQL().text,
    ).toBe(
      'SELECT string_agg("subquery"."value", $1 ORDER BY "subquery"."$order1" DESC) AS "stringAgg" FROM (SELECT (SELECT "form"."name" AS "name" FROM "form" AS "form" WHERE "form"."id" = "form_field"."form_id") AS "value", "form_field"."id" AS "$order1" FROM "form_field" AS "form_field") AS "subquery"',
    )
  })

  it("sort by the projection of the value, which the statement evaluates once", () => {
    const query = schema.form
      .pluck(form => form.fields.count())
      .orderBy((_form, value) => desc(value))

    expect(query.toSQL().text).toBe(
      'SELECT (SELECT count(*) AS "count" FROM "form_field" AS "form_field" WHERE "form_field"."form_id" = "form"."id") AS "value" FROM "form" AS "form" ORDER BY 1 DESC',
    )
  })

  it("reject a query other than of one value", () => {
    const message = "An expression takes a query of one value"

    // @ts-expect-error A query of records is not of one value.
    expect(() => schema.field.take().get(field => field.form.select("id"))).toThrow(message)
    // @ts-expect-error A query of an array is not of one value.
    expect(() => schema.form.pluck(form => form.fields.pluck("id"))).toThrow(message)
    // @ts-expect-error A query of records is not of one value.
    expect(() => schema.form.max(form => form.fields)).toThrow(message)
  })

  it("are checked by a Db at any depth, as a nested query of a selection", () => {
    const { driver } = createRecordingDriver()
    const same = bindSchema(schema, createDatabase({ driver }))
    // The same tables and the same keys, but other relation definitions.
    const other = bindSchema(
      defineSchema({ form, field, option }).$relations({
        form: {
          fields: many(field, { from: "id", to: "formId" }),
        },
      }),
      createDatabase({ driver }),
    )
    const message = 'Relation "form.fields" is not part of the schema'

    expect(() => same.$compile(schema.form.pluck(form => form.fields.count()))).not.toThrow()
    expect(() => other.$compile(schema.form.pluck(form => form.fields.count()))).toThrow(message)
    expect(() => other.$compile(schema.form.max(form => form.fields.count()))).toThrow(message)
    const nested = schema.option.pluck(option => option.field.get(field => field.form.get("name")))
    // @ts-expect-error The schema of the Db lacks the relation.
    expect(() => other.$compile(nested)).toThrow(
      'Relation "option.field" is not part of the schema',
    )
  })

  it("keep the bound query of another Db out of the statement", () => {
    const { driver } = createRecordingDriver()
    const db = bindSchema(schema, createDatabase({ driver }))
    const other = bindSchema(schema, createDatabase({ driver }))

    expect(() => db.$compile(db.form.pluck(() => other.field.count()))).toThrow(
      "A query in an expression is bound to another Db",
    )
  })
})

describePostgres("in PostgreSQL", ({ database, testTransaction, useTestFixture }) => {
  useTestFixture(() =>
    database.script(`
      CREATE SCHEMA tenant_1;
      CREATE TABLE tenant_1.form (id integer, name text);
      CREATE TABLE tenant_1.form_field (id integer, form_id integer, label text, weight integer);
      CREATE TABLE tenant_1.field_option (id integer, field_id integer, value text);
      INSERT INTO tenant_1.form VALUES (1, 'Survey'), (2, 'Feedback'), (3, 'Empty');
      INSERT INTO tenant_1.form_field VALUES (1, 1, 'Name', 3), (2, 1, 'Email', 1), (3, 1, NULL, 2), (4, 2, 'Comment', 5);
      INSERT INTO tenant_1.field_option VALUES (1, 1, 'First'), (2, 1, 'Last'), (3, 4, 'Short');
      CREATE TABLE tenant_1.author (id integer, email text);
      CREATE TABLE tenant_1.biography (id integer, author_id integer, author_email text, text text);
      INSERT INTO tenant_1.author VALUES (1, 'ada@example.com'), (2, 'alan@example.com');
      INSERT INTO tenant_1.biography VALUES (1, 1, 'ada@example.com', 'Ada');
    `),
  )

  const db = bindSchema(schema, database, { schemaName: "tenant_1" })
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

  // Orchid ORM confused a missing record and NULL of a value nested three levels deep: https://github.com/romeerez/orchid-orm/issues/830
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

  // Orchid ORM unwrapped a relation value selected twice under one key twice: https://github.com/romeerez/orchid-orm/issues/792
  it("decodes a related value that a later selection replaces under its key once", async () => {
    const firstWeight = db.form.orderBy("id").select(form => ({
      id: form.id,
      weight: form.fields.orderBy("id").get("weight").optional(),
    }))
    const reselected = firstWeight.select(form => ({
      weight: form.fields.orderBy("id").get("weight").optional(),
    }))

    expect(await testTransaction(async () => await reselected)).toStrictEqual([
      { id: 1, weight: { stars: 3 } },
      { id: 2, weight: { stars: 5 } },
      { id: 3, weight: undefined },
    ])
  })

  it("selects the record of a relation one for each row, telling a record of NULL values from a missing one", async () => {
    const options = db.option.orderBy("id").select(option => ({
      id: option.id,
      field: option.field.select("label"),
      label: option.field.get("label"),
    }))

    const rows = await testTransaction(async () => {
      await database.script(
        "INSERT INTO tenant_1.field_option VALUES (4, 3, 'Other'), (5, 9, 'Orphan')",
      )
      return await options
    })

    expect(rows).toStrictEqual([
      { id: 1, field: { label: "Name" }, label: "Name" },
      { id: 2, field: { label: "Name" }, label: "Name" },
      { id: 3, field: { label: "Comment" }, label: "Comment" },
      { id: 4, field: { label: null }, label: null },
      { id: 5, field: null, label: undefined },
    ])
  })

  it("selects the record of a relation one by a unique key, and null without it", async () => {
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

  it("rejects a missing record of a required relation with the relation and the path of its field", async () => {
    const options = db.option.orderBy("id").select(option => ({
      field: option.field.select(field => ({
        form: field.form.select("name"),
      })),
    }))

    await testTransaction(async () => {
      await database.script(`
        INSERT INTO tenant_1.form_field VALUES (5, 9, 'Orphan', 1);
        INSERT INTO tenant_1.field_option VALUES (4, 5, 'Orphan');
      `)
      const rejection = Promise.resolve(options)
      await expect(rejection).rejects.toThrow(RequiredRelationError)
      await expect(rejection).rejects.toMatchObject({
        relation: "field.form",
        path: "[3].field.form",
      })
    })
  })

  it("rejects a missing record of a required relation after a filter and required with NotFoundError", async () => {
    const fields = db.field.select(field => ({
      form: field.form.where({ name: "Missing" }).required().select("name"),
    }))

    const rejection = testTransaction(async () => await fields)
    await expect(rejection).rejects.toThrow(NotFoundError)
    await expect(rejection).rejects.toMatchObject({ path: "[0].form" })
  })

  it("rejects several records of a relation one", async () => {
    const fields = db.field.select(field => ({
      form: field.form.select("name"),
    }))

    await testTransaction(async () => {
      await database.script("INSERT INTO tenant_1.form VALUES (1, 'Copy')")
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

  it("selects the related records of the rows of a page after an offset, also of a nested page after an offset", async () => {
    const pages = db.form
      .orderBy({ id: "desc" })
      .offset(2)
      .select(form => ({
        id: form.id,
        fields: form.fields
          .orderBy({ id: "desc" })
          .offset(1)
          .select(field => ({
            id: field.id,
            options: field.options.orderBy("id").pluck("value"),
          })),
      }))
    const second = db.form
      .orderBy("id")
      .offset(1)
      .take()
      .select(form => ({
        id: form.id,
        labels: form.fields.orderBy("id").pluck("label"),
      }))

    expect(await testTransaction(async () => [await pages, await second])).toStrictEqual([
      [
        {
          id: 1,
          fields: [
            { id: 2, options: [] },
            { id: 1, options: ["First", "Last"] },
          ],
        },
      ],
      { id: 2, labels: ["Comment"] },
    ])
  })

  it("filters records by whether related records exist, also negated, of a query that a helper prepares, and of an independent query", async () => {
    const labeled = defineHelper(schema.field, (field, label: string) => field.where({ label }))
    const ids = (query: typeof db.form) => query.orderBy("id").pluck("id")

    const results = await testTransaction(async () => [
      await ids(db.form.where(form => form.fields.exists())),
      await ids(db.form.where(form => not(form.fields.exists()))),
      await ids(db.form.where(form => form.fields.use(labeled, "Comment").exists())),
      await ids(db.form.where(() => db.option.where({ value: "Short" }).exists())),
      await ids(db.form.where(() => db.option.where({ value: "Long" }).exists())),
      await db.field.where(field => field.form.get(form => form.name.eq("Feedback"))).pluck("id"),
    ])

    expect(results).toEqual([[1, 2], [3], [2], [1, 2, 3], [], [4]])
  })

  it("compares with the value of a query of one value, NULL without its row, and replaces NULL with it", async () => {
    const results = await testTransaction(async () => [
      // The last field of each form.
      await db.field
        .where(field => field.id.eq(db.field.where({ formId: field.formId }).max("id")))
        .orderBy("id")
        .pluck("id"),
      await db.field.where({ formId: db.form.where({ name: "Feedback" }).get("id") }).pluck("id"),
      await db.field.where({ formId: db.form.where({ name: "Missing" }).get("id") }).pluck("id"),
      await db.form
        .where(form => form.id.in([db.field.find(4).get("formId"), 3]))
        .orderBy("id")
        .pluck("id"),
      await db.form.orderBy("id").select(form => ({
        label: form.fields.min("label").coalesce(db.form.find(form.id).get("name")),
      })),
    ])

    expect(results).toEqual([
      [3, 4],
      [4],
      [],
      [2, 3],
      [{ label: "Email" }, { label: "Comment" }, { label: "Empty" }],
    ])
  })

  it("applies operators to the value of a query, NULL without its row, in filters, sort keys, and selected fields", async () => {
    const results = await testTransaction(async () => [
      await db.form
        .where(form => form.fields.count().expr().gt(1))
        .orderBy("id")
        .pluck("id"),
      await db.field
        .where(field => field.form.get("name").expr().ilike("feed%"))
        .orderBy("id")
        .pluck("id"),
      // A form without fields and a field without a label, whose minimum is NULL.
      await db.form
        .where(form => form.fields.min("label").expr().isNull())
        .orderBy("id")
        .pluck("id"),
      // A sum and an average, whose values PostgreSQL types as `bigint` and `numeric`, which type the parameters.
      await db.form
        .where(form => form.fields.sum("id").expr().gte(4))
        .orderBy("id")
        .pluck("id"),
      await db.form
        .where(form => form.fields.avg("id").expr().gt(2.5))
        .orderBy("id")
        .pluck("id"),
      await db.form.orderBy(form => desc(form.fields.count().expr())).pluck("id"),
      // The sort key of the selected field is its projection.
      await db.form
        .select(form => ({
          total: form.fields.count().expr(),
        }))
        .orderBy((_, selected) => desc(selected.total))
        .limit(1),
      await db.form.orderBy("id").select(form => ({
        fieldCount: form.fields.count().expr(),
        several: form.fields.count().expr().gt(1),
        firstId: form.fields.min("id").expr(),
        hasFields: form.fields.exists().expr(),
        firstLabel: form.fields.orderBy("id").get("label").expr(),
      })),
    ])

    expect(results).toEqual([
      [1],
      [4],
      [3],
      [1, 2],
      [2],
      [1, 2, 3],
      [{ total: 3 }],
      [
        { fieldCount: 3, several: true, firstId: 1, hasFields: true, firstLabel: "Name" },
        { fieldCount: 1, several: false, firstId: 4, hasFields: true, firstLabel: "Comment" },
        { fieldCount: 0, several: false, firstId: null, hasFields: false, firstLabel: null },
      ],
    ])
  })

  it("filters by the values of a query with in, NULL among them matching no record", async () => {
    const results = await testTransaction(async () => [
      // The forms that have a field with options.
      await db.form
        .where(form => form.id.in(db.field.where(field => field.options.exists()).pluck("formId")))
        .orderBy("id")
        .pluck("id"),
      await db.field
        .where(field => field.label.in(db.field.where({ formId: 1 }).pluck("label")))
        .orderBy("id")
        .pluck("id"),
      // The fields of the first 2 forms by name.
      await db.field
        .where(field => field.formId.in(db.form.orderBy("name").limit(2).pluck("id")))
        .pluck("id"),
      await db.form.orderBy("id").select(form => ({
        withOptions: form.fields
          .where(field => field.id.in(db.option.pluck("fieldId")))
          .pluck("id"),
      })),
      await db.field
        .where(field => field.formId.in(db.form.where({ name: "Feedback" }).pluck("id")))
        .update({ label: "Note" })
        .pluck("label"),
    ])

    expect(results).toEqual([
      [1, 2],
      [1, 2],
      [4],
      [{ withOptions: [1] }, { withOptions: [4] }, { withOptions: [] }],
      ["Note"],
    ])
  })

  it("filters by queries in SQL fragments, as subqueries or as their values, also in a statement of SQL text", async () => {
    const results = await testTransaction(async () => [
      await db.form.where(form => sql`EXISTS ${form.fields.where({ label: null })}`).pluck("id"),
      await db.form.where(form => sql`NOT EXISTS (${form.fields})`).pluck("id"),
      await db.field
        .where(
          field => sql`${field.formId} = ANY ${db.form.where({ name: "Feedback" }).pluck("id")}`,
        )
        .pluck("id"),
      await db.form.where(form => sql`${form.fields.count()} > ${1}`).pluck("id"),
      await db.form.where(form => sql`NOT ${form.fields.exists()}`).pluck("id"),
      await db.$query`
        SELECT count(*) FROM ${db.field.where({ formId: 1 }).select("id", "label")} AS field (id, label)
        WHERE label IS NOT NULL
      `.get(t.integer),
    ])

    expect(results).toEqual([[1], [3], [4], [1], [3], 2])
  })

  it("selects whether related records exist for each row, also of a page after an offset, and a condition of get, null without its row", async () => {
    const labeled = defineHelper(schema.field, (field, label: string) => field.where({ label }))
    const query = db.form
      .orderBy("id")
      .select("id")
      .select(form => ({
        hasFields: form.fields.exists(),
        hasEmail: form.fields.use(labeled, "Email").exists(),
        empty: not(form.fields.exists()),
        emailLabeled: not(form.fields.use(labeled, "Email").get(field => field.label.isNull())),
      }))

    const results = await testTransaction(async () => [await query, await query.limit(1).offset(1)])

    expect(results).toEqual([
      [
        { id: 1, hasFields: true, hasEmail: true, empty: false, emailLabeled: true },
        { id: 2, hasFields: true, hasEmail: false, empty: false, emailLabeled: null },
        { id: 3, hasFields: false, hasEmail: false, empty: true, emailLabeled: null },
      ],
      [{ id: 2, hasFields: true, hasEmail: false, empty: false, emailLabeled: null }],
    ])
  })

  it("counts the records of a relation for each parent, also of a page", async () => {
    const counted = db.form.orderBy("id").select(form => ({
      id: form.id,
      fieldCount: form.fields.count(),
      labeledCount: form.fields.where(not({ label: null })).count(),
      pageCount: form.fields.orderBy("id").limit(2).offset(1).count(),
    }))

    expect(await testTransaction(async () => await counted)).toEqual([
      { id: 1, fieldCount: 3, labeledCount: 2, pageCount: 2 },
      { id: 2, fieldCount: 1, labeledCount: 1, pageCount: 0 },
      { id: 3, fieldCount: 0, labeledCount: 0, pageCount: 0 },
    ])
  })

  it("sorts by an aggregate of related records, by whether they exist, and by a value of a related record, also by a selected field of an aggregate of a page", async () => {
    const results = await testTransaction(async () => [
      await db.form.orderBy(form => form.fields.count()).pluck("id"),
      await db.form.orderBy(form => [desc(form.fields.exists()), desc(form.id)]).pluck("id"),
      await db.field.orderBy(field => [field.form.get("name"), field.id]).pluck("id"),
      await db.form
        .select(form => ({
          id: form.id,
          fieldCount: form.fields.count(),
        }))
        .orderBy((_form, selected) => desc(selected.fieldCount))
        .offset(1),
    ])

    expect(results).toEqual([
      [3, 2, 1],
      [2, 1, 3],
      [4, 1, 2, 3],
      [
        { id: 2, fieldCount: 1 },
        { id: 3, fieldCount: 0 },
      ],
    ])
  })

  it("aggregates the records of a relation for each parent by the type of their values, also of a page in the order of the relation, replacing NULL with a fallback", async () => {
    const aggregated = db.form.orderBy("id").select(form => ({
      id: form.id,
      heaviest: form.fields.max("weight"),
      totalWeight: form.fields.sum("weight"),
      averageWeight: form.fields.avg("weight"),
      labels: form.fields.orderBy({ weight: "desc" }).stringAgg("label", ", "),
      lightestLabels: form.fields.orderBy("weight").limit(2).stringAgg("label", ", "),
      hasUnlabeled: form.fields.some(field => field.label.isNull()),
      heaviestOrNone: form.fields.max("weight").coalesce({ stars: 0 }),
      lastFieldOrForm: form.fields.max("id").coalesce(form.id),
      formIdPerField: form.fields.sum(() => form.id),
    }))

    expect(await testTransaction(async () => await aggregated)).toEqual([
      {
        id: 1,
        heaviest: { stars: 3 },
        totalWeight: { stars: 6 },
        averageWeight: { stars: 2 },
        labels: "Name, Email",
        lightestLabels: "Email",
        hasUnlabeled: true,
        heaviestOrNone: { stars: 3 },
        lastFieldOrForm: 3,
        formIdPerField: 3,
      },
      {
        id: 2,
        heaviest: { stars: 5 },
        totalWeight: { stars: 5 },
        averageWeight: { stars: 5 },
        labels: "Comment",
        lightestLabels: "Comment",
        hasUnlabeled: false,
        heaviestOrNone: { stars: 5 },
        lastFieldOrForm: 4,
        formIdPerField: 2,
      },
      {
        id: 3,
        heaviest: null,
        totalWeight: null,
        averageWeight: null,
        labels: null,
        lightestLabels: null,
        hasUnlabeled: null,
        heaviestOrNone: { stars: 0 },
        lastFieldOrForm: 3,
        formIdPerField: null,
      },
    ])
  })

  it("counts the record of a relation one, and the records of a relation inside a page of nested rows", async () => {
    const fields = db.field.orderBy("id").select(field => ({
      id: field.id,
      formCount: field.form.count(),
      surveyCount: field.form.where({ name: "Survey" }).count(),
    }))
    const forms = db.form.orderBy("id").select(form => ({
      id: form.id,
      fields: form.fields
        .orderBy("id")
        .limit(1)
        .select(field => ({
          id: field.id,
          optionCount: field.options.count(),
        })),
    }))

    expect(await testTransaction(async () => [await fields, await forms])).toEqual([
      [
        { id: 1, formCount: 1, surveyCount: 1 },
        { id: 2, formCount: 1, surveyCount: 1 },
        { id: 3, formCount: 1, surveyCount: 1 },
        { id: 4, formCount: 1, surveyCount: 0 },
      ],
      [
        { id: 1, fields: [{ id: 1, optionCount: 2 }] },
        { id: 2, fields: [{ id: 4, optionCount: 1 }] },
        { id: 3, fields: [] },
      ],
    ])
  })

  describe("in the callbacks of values", () => {
    it("gives the value of a relation for each row, NULL without its row", async () => {
      const values = await testTransaction(async () => ({
        counts: await db.form.orderBy("id").pluck(form => form.fields.count()),
        filled: await db.form.orderBy("id").pluck(form => form.fields.exists()),
        name: await db.field.find(4).get(field => field.form.get("name")),
        first: await db.form.find(1).get(form => form.fields.orderBy("id").get("label")),
        missing: await db.form.find(3).get(form => form.fields.orderBy("id").get("label")),
        decoded: await db.form.find(2).get(form => form.fields.max("weight")),
      }))

      expect(values).toEqual({
        counts: [3, 1, 0],
        filled: [true, true, false],
        name: "Feedback",
        first: "Name",
        missing: null,
        decoded: { stars: 5 },
      })
    })

    it("aggregates the values of a relation over the rows of the query", async () => {
      const values = await testTransaction(async () => ({
        max: await db.form.max(form => form.fields.count()),
        sum: await db.form.sum(form => form.fields.count()),
        count: await db.form.count(form => form.fields.max("id")),
        distinct: await db.field.countDistinct(field => field.form.get("name")),
        every: await db.field.every(field => field.options.exists()),
        some: await db.field.some(field => field.options.exists()),
        joined: await db.field
          .orderBy({ id: "desc" })
          .stringAgg(field => field.form.get("name"), ","),
        page: await db.field
          .orderBy("id")
          .limit(2)
          .offset(1)
          .max(field => field.options.count()),
      }))

      expect(values).toEqual({
        max: 3,
        sum: 4,
        count: 2,
        distinct: 2,
        every: false,
        some: true,
        joined: "Feedback,Survey,Survey,Survey",
        page: 0,
      })
    })

    it("sorts and pages by the value, also of nested rows", async () => {
      const values = await testTransaction(async () => ({
        sorted: await db.form
          .pluck(form => form.fields.count())
          .orderBy((_form, value) => desc(value)),
        nested: await db.form.orderBy("id").select(form => ({
          byId: form.fields.orderBy({ id: "desc" }).pluck(field => field.options.count()),
          byValue: form.fields
            .pluck(field => field.options.count())
            .orderBy((_field, value) => desc(value)),
          page: form.fields
            .orderBy("id")
            .limit(1)
            .offset(1)
            .pluck(field => field.options.exists()),
          top: form.fields.max(field => field.options.count()),
        })),
      }))

      expect(values).toEqual({
        sorted: [3, 1, 0],
        nested: [
          { byId: [0, 0, 2], byValue: [2, 0, 0], page: [false], top: 2 },
          { byId: [1], byValue: [1], page: [], top: 1 },
          { byId: [], byValue: [], page: [], top: null },
        ],
      })
    })

    it("reads a relation at any depth of the callback", async () => {
      const optionCounts = await testTransaction(
        async () =>
          await db.form
            .orderBy("id")
            .pluck(form => form.fields.sum(field => field.options.count())),
      )

      expect(optionCounts).toEqual([2, 1, null])
    })
  })

  describe("of tables and fields with long names", () => {
    // PostgreSQL keeps 63 bytes of an identifier: the ASCII name takes all of them, and the Cyrillic one takes 61 bytes in UTF-8, while kern-orm counts each of its characters as 4 bytes, the most in a server encoding.
    const tableNames = [`category_${"x".repeat(54)}`, "категория_товаров_каталога_лавки"]
    // Keys that differ only after 63 bytes, and a Cyrillic key of 72 bytes in UTF-8.
    const prefix = "k".repeat(63)
    const subcategoriesKey = "подкатегории".repeat(3)

    useTestFixture(() =>
      database.script(
        tableNames
          .map(
            name => `
              CREATE TABLE tenant_1."${name}" (id integer, parent_id integer);
              INSERT INTO tenant_1."${name}" VALUES (1, NULL), (2, 1), (3, 1), (4, 2);
            `,
          )
          .join(""),
      ),
    )

    it("selects the records of a relation of a table to itself into fields whose keys differ only after 63 bytes, sorted and paginated at any depth", async () => {
      const queries = tableNames.map(name => {
        const category = defineTable(name, {
          id: t.integer.primaryKey(),
          parentId: t.integer.nullable().columnName("parent_id"),
        })
        const tree = defineSchema({ category }).$relations({
          category: {
            parent: one(category, { from: "parentId", to: "id" }),
            children: many(category, { from: "id", to: "parentId" }),
          },
        })
        return bindSchema(tree, database, { schemaName: "tenant_1" })
          .category.where({ parentId: null })
          .select(category => ({
            [`${prefix}First`]: category.children
              .orderBy("id")
              .limit(2)
              .select(child => ({
                [`${prefix}Parent`]: child.parent.get("id"),
                [subcategoriesKey]: child.children.orderBy({ id: "desc" }).pluck("id"),
              })),
            [`${prefix}Descending`]: category.children.orderBy({ id: "desc" }).pluck("id"),
            [`${prefix}Count`]: category.children.count(),
          }))
      })

      const results = await testTransaction(() =>
        Promise.all(queries.map(async query => await query)),
      )

      for (const result of results) {
        expect(result).toStrictEqual([
          {
            [`${prefix}First`]: [
              { [`${prefix}Parent`]: 1, [subcategoriesKey]: [4] },
              { [`${prefix}Parent`]: 1, [subcategoriesKey]: [] },
            ],
            [`${prefix}Descending`]: [3, 2],
            [`${prefix}Count`]: 2,
          },
        ])
      }
    })
  })
})
