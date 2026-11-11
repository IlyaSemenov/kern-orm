import { describe, expect, it } from "bun:test"

import { describePostgres } from "../../testing/postgres"
import { combineNodes } from "../ast/boolean"
import type { ProjectionNode } from "../ast/nodes"
import { bindSchema } from "../execution/db"
import { count, max, sum } from "../expression/aggregates"
import { FALSE } from "../expression/constants"
import { toNode } from "../expression/expression"
import { coalesce } from "../expression/functions"
import { and, or } from "../expression/predicates"
import { param, sql } from "../expression/sql"
import { many, one } from "../schema/relation"
import { defineSchema } from "../schema/schema"
import { defineTable } from "../table/table"
import * as t from "../types"

import { noContext } from "./column-refs"
import { addGroupKeys } from "./group"
import { literal } from "./literal"
import { desc } from "./order"
import type { AnySelectQuery } from "./select"
import { from } from "./select"

const form = defineTable("form", {
  id: t.integer.primaryKey(),
  name: t.text,
  threshold: t.integer,
})

const field = defineTable("form_field", {
  id: t.integer.primaryKey(),
  formId: t.integer,
  position: t.integer,
  label: t.text,
})

const schema = defineSchema({ form, field }).$relations({
  form: {
    fields: many(field, { from: "id", to: "formId" }),
  },
  field: {
    form: one(form, { from: "formId", to: "id", required: true }),
  },
})

describe("groupBy", () => {
  const fields = from(field)
  const source = fields.node.from

  it("adds the listed columns after the keys of earlier calls", () => {
    const grouped = fields.groupBy("formId").groupBy("label", "position")

    expect(grouped.node.groupBy).toEqual([
      { kind: "column", source, key: "formId" },
      { kind: "column", source, key: "label" },
      { kind: "column", source, key: "position" },
    ])
  })

  it("adds a key or an array of keys that the callback returns: an expression or a query of one value", () => {
    const bucket = sql(t.integer)`1`
    const relations = schema.field.select("id")

    expect(fields.groupBy(() => bucket).node.groupBy).toEqual([toNode(bucket)])
    expect(fields.groupBy(field => [field.formId, bucket]).node.groupBy).toEqual([
      { kind: "column", source, key: "formId" },
      toNode(bucket),
    ])
    expect(relations.groupBy(field => field.form.get("name")).node.groupBy).toMatchObject([
      { kind: "nestedQuery" },
    ])
  })

  it("names a column by a string, never a selected field under the key", () => {
    const query = from(field)
      .select(field => ({
        label: field.position,
        total: count(),
      }))
      .groupBy("label")

    expect(query.toSQL().text).toBe(
      'SELECT "form_field"."position" AS "label", count(*) AS "total" FROM "form_field" AS "form_field" GROUP BY "form_field"."label"',
    )
  })

  it("gives the callback the fields selected so far, whose keys are their projections, and the value of a query of values", () => {
    const records = from(field).select(field => ({
      bucket: sql(t.integer)`${field.position} % ${3}`,
      fieldCount: schema.field.count(),
    }))
    const values = from(field).pluck(field => sql(t.integer)`${field.position} % ${3}`)

    expect(records.groupBy((_field, selected) => selected.bucket).node.groupBy[0]).toBe(
      (records.node.projections[0] as ProjectionNode).expression,
    )
    expect(records.groupBy((_field, selected) => selected.fieldCount).node.groupBy).toMatchObject([
      { kind: "nestedQuery", field: records.node.projections[1] },
    ])
    expect(values.groupBy((_field, value) => value).node.groupBy[0]).toBe(
      (values.node.projections[0] as ProjectionNode).expression,
    )
  })

  it("rejects reading a selected field of nested rows or of a literal, which it cannot group by", () => {
    const query = schema.form.select(form => ({
      fields: form.fields.select("id"),
      note: literal("note"),
    }))

    expect(() => query.groupBy((_form, selected) => selected.fields as never)).toThrow(
      'Field "fields" holds nested rows and cannot be grouped by',
    )
    expect(() => query.groupBy((_form, selected) => selected.note as never)).toThrow(
      'Field "note" holds a literal and cannot be grouped by',
    )
  })

  it("rejects a call without keys", () => {
    const message = "groupBy requires at least one key"

    expect(() => fields.groupBy()).toThrow(message)
    expect(() => fields.groupBy(() => [])).toThrow(message)
    expect(() => addGroupKeys("groupBy", fields.groupBy("label").node, noContext, [])).toThrow(
      message,
    )
  })

  it("rejects what is not a key", () => {
    const message = "The callback of groupBy must return expressions or queries of one value"

    expect(() => fields.groupBy("unknown" as never)).toThrow('Unknown column "unknown"')
    expect(() => fields.groupBy({ label: "asc" } as never)).toThrow(
      "groupBy takes column keys or a callback",
    )
    expect(() => fields.groupBy(() => "label" as never)).toThrow(message)
    expect(() => fields.groupBy(field => desc(field.label) as never)).toThrow(message)
    expect(() => fields.groupBy(() => from(field).pluck("id") as never)).toThrow(
      "An expression takes a query of one value",
    )
  })

  it("rejects a query made by an aggregate method, exists, or map, and a query with a row lock", () => {
    // Types reject these calls, which a query held as any query can still make.
    const queries: [AnySelectQuery, string][] = [
      [fields.count(), "groupBy cannot be used after an aggregate"],
      [fields.exists(), "groupBy cannot be used after exists"],
      [fields.select("id").map(row => row.id), "groupBy cannot be used after map"],
      [
        fields.forUpdate(),
        "groupBy cannot be used after a row lock, since a group comes from several rows of the table",
      ],
    ]
    for (const [query, message] of queries) {
      expect(() => query.groupBy("label")).toThrow(message)
    }
  })

  it("keeps the rows that a filter chooses apart from the groups, wherever the filter is in the chain", () => {
    const query = fields.groupBy("label").where({ formId: 1 }).select("label")

    expect(query.toSQL().text).toBe(
      'SELECT "form_field"."label" AS "label" FROM "form_field" AS "form_field" WHERE "form_field"."formId" = $1 GROUP BY 1',
    )
  })
})

describe("having", () => {
  const fields = from(field)

  it("requires an earlier groupBy", () => {
    expect(() => fields.having(() => count().gt(1))).toThrow(
      "having requires an earlier groupBy; filter the rows with where",
    )
  })

  it("combines the conditions of its calls with AND, apart from the filters of the rows", () => {
    const first = count().gt(1)
    const second = max(sql(t.integer)`1`).gt(2)
    const query = fields
      .groupBy("label")
      .where({ formId: 1 })
      .having(() => first)
      .having(() => second)

    expect(query.node.having).toEqual(combineNodes("and", [toNode(first), toNode(second)]))
    expect(query.node.filters.user).toMatchObject({ kind: "comparison" })
  })

  it("takes what where takes: a condition, an object of column values, and a callback with the relations of the table", () => {
    const grouped = schema.field.groupBy("formId", "label").select("formId", "label")

    expect(grouped.having({ label: "Name" }).toSQL().text).toEndWith(
      'GROUP BY 1, 2 HAVING "form_field"."label" = $1',
    )
    expect(grouped.having(count().gt(1)).toSQL().text).toEndWith(
      "GROUP BY 1, 2 HAVING count(*) > $1",
    )
    expect(grouped.having(field => field.form.exists()).toSQL().text).toEndWith(
      'GROUP BY 1, 2 HAVING EXISTS (SELECT FROM "form" AS "form" WHERE "form"."id" = "form_field"."formId")',
    )
  })

  it("gives a callback the fields selected so far, each compiled as a copy of its expression, which HAVING cannot refer to by position", () => {
    const query = schema.field
      .select(field => ({
        formId: field.formId,
        fieldCount: count({ filter: field.position.lt(5) }),
        hasForm: field.form.exists(),
      }))
      .groupBy("formId")
      .having((_field, selected) => and(selected.fieldCount.gt(1), selected.hasForm))

    expect(query.toSQL()).toEqual({
      text: 'SELECT "form_field"."formId" AS "formId", count(*) FILTER (WHERE "form_field"."position" < $1) AS "fieldCount", EXISTS (SELECT FROM "form" AS "form" WHERE "form"."id" = "form_field"."formId") AS "hasForm" FROM "form_field" AS "form_field" GROUP BY 1 HAVING count(*) FILTER (WHERE "form_field"."position" < $2) > $3 AND EXISTS (SELECT FROM "form" AS "form_2" WHERE "form_2"."id" = "form_field"."formId")',
      parameters: ["5", "5", "1"],
    })
  })

  it("gives a callback the value of a query made by get or pluck", () => {
    const query = fields
      .groupBy("formId")
      .pluck(() => count())
      .having((_field, fieldCount) => fieldCount.gt(1))

    expect(query.toSQL().text).toEndWith('GROUP BY "form_field"."formId" HAVING count(*) > $1')
  })

  it("rejects reading a selected field of nested rows or of a literal", () => {
    const query = schema.form.groupBy("id").select(form => ({
      fields: form.fields.select("id"),
      note: literal("note"),
    }))

    expect(() => query.having((_form, selected) => selected.fields as never)).toThrow(
      'Field "fields" holds nested rows and cannot be read in having',
    )
    expect(() => query.having((_form, selected) => selected.note as never)).toThrow(
      'Field "note" holds a literal and cannot be read in having',
    )
  })

  it("gives a callback no fields after an aggregate method, exists, or map, whose fields are not those of the groups", () => {
    const grouped = fields.groupBy("formId")
    const queries: AnySelectQuery[] = [
      grouped.count(),
      grouped.exists(),
      grouped.select("formId").map(row => row.formId),
    ]
    for (const query of queries) {
      let received: unknown = null
      query.having((_field: unknown, selected: unknown) => {
        received = selected
        return count().gt(1)
      })
      expect(received).toBeUndefined()
    }
  })

  it("ends the guarantee of the row of a required relation, as where does", () => {
    const query = schema.field.select(field => {
      const groups = field.form.groupBy("id").having(() => count().gt(1))
      expect(groups.node).toMatchObject({ rows: "nullable", guaranteed: false })
      expect(
        field.form
          .get("name")
          .groupBy("id")
          .having(() => count().gt(1)).node,
      ).toMatchObject({
        rows: "optional",
        guaranteed: false,
      })
      return {
        form: groups.select("id"),
      }
    })

    expect(query.toSQL().text).toContain("GROUP BY 1 HAVING count(*) > $1")
  })
})

describePostgres("in PostgreSQL", ({ database, testTransaction, useTestFixture }) => {
  useTestFixture(() =>
    database.script(`
      CREATE TABLE form (id integer PRIMARY KEY, name text NOT NULL, threshold integer NOT NULL);
      CREATE TABLE form_field (
        id integer PRIMARY KEY,
        "formId" integer NOT NULL,
        position integer NOT NULL,
        label text NOT NULL
      );
      INSERT INTO form (id, name, threshold) VALUES (1, 'Survey', 1), (2, 'Contact', 2), (3, 'Draft', 5);
      INSERT INTO form_field (id, "formId", position, label) VALUES
        (1, 1, 1, 'Name'),
        (2, 1, 2, 'Email'),
        (3, 1, 7, 'Phone'),
        (4, 2, 1, 'Name'),
        (5, 2, 5, 'Email');
    `),
  )

  const db = bindSchema(schema, database)
  const totals = db.field.groupBy("formId").select(field => ({
    formId: field.formId,
    positions: coalesce(sum(field.position), 0),
    fieldCount: count(),
  }))

  it("gives the aggregates of each group, with a nested query correlated on a key, sorted by a selected aggregate", async () => {
    const groups = await testTransaction(
      async () =>
        await db.field
          .where(field => field.position.lt(7))
          .groupBy("formId")
          .select(field => ({
            formId: field.formId,
            form: field.form.select("name"),
            total: sum(field.position),
            fieldCount: count(),
          }))
          .orderBy((_field, selected) => desc(selected.total)),
    )

    expect(groups).toStrictEqual([
      { formId: 2, form: { name: "Contact" }, total: 6, fieldCount: 2 },
      { formId: 1, form: { name: "Survey" }, total: 3, fieldCount: 2 },
    ])
  })

  it("preserves NULL for empty filtered aggregates and permits explicitly nullable outer aggregates", async () => {
    const results = await testTransaction(async () => ({
      groups: await db.field
        .groupBy("formId")
        .orderBy("formId")
        .select(field => ({
          total: sum(field.position),
          missing: sum(field.position, { filter: FALSE }),
          constant: max(param(t.integer, 7)),
        })),
      outer: await db.$execute(
        from(field)
          .where(FALSE)
          .select(outer => ({
            groups: from(field)
              .groupBy("formId")
              .pluck(() => sql(t.integer.nullable())`sum(${outer.position})`),
          })),
      ),
    }))
    expect(results).toStrictEqual({
      groups: [
        { total: 10, missing: null, constant: 7 },
        { total: 6, missing: null, constant: 7 },
      ],
      outer: [{ groups: [null, null] }],
    })
  })

  it("filters the groups by their aggregates", async () => {
    const formIds = await testTransaction(
      async () =>
        await db.field
          .groupBy("formId")
          .having(() => count().gt(2))
          .pluck("formId"),
    )

    expect(formIds).toStrictEqual([1])
  })

  it("filters the groups by a selected aggregate through its field", async () => {
    const groups = await testTransaction(
      async () =>
        await db.field
          .select(field => ({
            formId: field.formId,
            early: count({ filter: field.position.lt(5) }),
          }))
          .groupBy("formId")
          .having((_field, selected) => selected.early.gt(1)),
    )

    expect(groups).toStrictEqual([{ formId: 1, early: 2 }])
  })

  it("groups by a selected expression with parameters, also sorted by it, by the position of its projection", async () => {
    const buckets = await testTransaction(
      async () =>
        await db.field
          .select(field => ({
            bucket: sql(t.integer)`${field.position} % ${2}`,
            fieldCount: count(),
          }))
          .groupBy((_field, selected) => selected.bucket)
          .orderBy((_field, selected) => selected.bucket),
    )

    expect(buckets).toStrictEqual([
      { bucket: 0, fieldCount: 1 },
      { bucket: 1, fieldCount: 4 },
    ])
  })

  it("reads in having a selected key with a parameter of param through its field, beside an aggregate under or, also in a page of groups with a nested query", async () => {
    const buckets = db.field
      .select(field => ({
        bucket: sql(t.integer)`${field.position} % ${param(t.integer, 2)}`,
        fieldCount: count(),
      }))
      .groupBy((_field, selected) => selected.bucket)
      .having((_field, selected) => or(selected.bucket.eq(0), selected.fieldCount.gt(4)))

    const results = await testTransaction(async () => ({
      groups: await buckets,
      page: await buckets.offset(0).select(() => ({
        forms: db.form.orderBy("id").pluck("id"),
      })),
    }))

    expect(results).toStrictEqual({
      groups: [{ bucket: 0, fieldCount: 1 }],
      page: [{ bucket: 0, fieldCount: 1, forms: [1, 2, 3] }],
    })
  })

  it("groups by a selected value of a related record through its expression, and of an aggregate of related records", async () => {
    const results = await testTransaction(async () => ({
      names: await db.field
        .select(field => ({
          name: field.form.get("name").expr(),
          fieldCount: count(),
        }))
        .groupBy((_field, selected) => selected.name)
        .orderBy((_field, selected) => selected.name),
      sizes: await db.form
        .select(form => ({
          size: form.fields.count(),
          forms: count(),
        }))
        .groupBy((_form, selected) => selected.size)
        .orderBy((_form, selected) => selected.size),
    }))

    expect(results).toStrictEqual({
      names: [
        { name: "Contact", fieldCount: 2 },
        { name: "Survey", fieldCount: 3 },
      ],
      sizes: [
        { size: 0, forms: 1 },
        { size: 2, forms: 1 },
        { size: 3, forms: 1 },
      ],
    })
  })

  it("applies limit, offset, take, get, pluck, distinct, map, transform, and use to the groups", async () => {
    const byFormId = totals.orderBy("formId")
    const results = await testTransaction(async () => ({
      limited: await byFormId.limit(1),
      offset: await byFormId.offset(1),
      taken: await byFormId.take(),
      value: await db.field.groupBy("formId").orderBy("formId").get("formId"),
      values: await db.field.groupBy("formId").orderBy("formId").pluck("formId"),
      distinct: await db.field
        .select(() => ({
          fieldCount: count(),
        }))
        .groupBy("formId")
        .distinct()
        .orderBy((_field, selected) => selected.fieldCount),
      mapped: await byFormId.map(group => group.formId + 1),
      transformed: await byFormId.transform(groups => groups.length),
      used: await byFormId.use(query => query.limit(1)),
    }))

    const first = { formId: 1, positions: 10, fieldCount: 3 }
    const second = { formId: 2, positions: 6, fieldCount: 2 }
    expect(results).toStrictEqual({
      limited: [first],
      offset: [second],
      taken: first,
      value: 1,
      values: [1, 2],
      distinct: [{ fieldCount: 2 }, { fieldCount: 3 }],
      mapped: [2, 3],
      transformed: 2,
      used: [first],
    })
  })

  it("selects nested queries of a page of groups after an offset and of the first groups of distinctOn, also of nested groups and of a table grouped by its primary key with a window function over all its groups", async () => {
    const results = await testTransaction(async () => ({
      page: await db.field
        .groupBy("formId")
        .having(() => count().lt(3))
        .select(field => ({
          formId: field.formId,
          form: field.form.select("name"),
          fieldCount: count(),
        }))
        .orderBy((_field, selected) => desc(selected.fieldCount))
        .offset(0),
      first: await db.field
        .groupBy("label", "formId")
        .distinctOn("label")
        .orderBy(field => [field.label, desc(sum(field.position)), field.formId])
        .select(field => ({
          label: field.label,
          form: field.form.select("name"),
        })),
      nested: await db.form.orderBy("id").select(form => ({
        id: form.id,
        labels: form.fields
          .groupBy("label")
          .orderBy("label")
          .offset(1)
          .select(field => ({
            label: field.label,
            forms: db.field
              .where(other => other.label.eq(field.label))
              .orderBy("formId")
              .pluck("formId"),
          })),
      })),
      forms: await db.form
        .groupBy("id")
        .orderBy("id")
        .offset(1)
        .select(form => ({
          name: form.name,
          formCount: sql(t.integer)`count(*) OVER ()`,
          labels: form.fields.orderBy("position").pluck("label"),
        })),
    }))

    expect(results).toStrictEqual({
      page: [{ formId: 2, form: { name: "Contact" }, fieldCount: 2 }],
      first: [
        { label: "Email", form: { name: "Contact" } },
        { label: "Name", form: { name: "Survey" } },
        { label: "Phone", form: { name: "Survey" } },
      ],
      nested: [
        {
          id: 1,
          labels: [
            { label: "Name", forms: [1, 2] },
            { label: "Phone", forms: [1] },
          ],
        },
        { id: 2, labels: [{ label: "Name", forms: [1, 2] }] },
        { id: 3, labels: [] },
      ],
      forms: [
        { name: "Contact", formCount: 3, labels: ["Name", "Email"] },
        { name: "Draft", formCount: 3, labels: [] },
      ],
    })
  })

  it("aggregates the groups with an aggregate method, and checks whether a group exists", async () => {
    const severalFields = db.field.groupBy("formId").having(() => count().gt(2))
    const results = await testTransaction(async () => ({
      groups: await db.field.groupBy("formId").count(),
      filteredGroups: await severalFields.count(),
      largestSum: await db.field.groupBy("formId").max(field => sum(field.position)),
      smallestCount: await db.field.groupBy("formId").min(() => count()),
      exists: await severalFields.exists(),
      missing: await db.field
        .groupBy("formId")
        .having(() => count().gt(3))
        .exists(),
    }))

    expect(results).toStrictEqual({
      groups: 2,
      filteredGroups: 1,
      largestSum: 10,
      smallestCount: 2,
      exists: true,
      missing: false,
    })
  })

  it("selects the groups of a nested query and of $select, and takes them in a list of in", async () => {
    const results = await testTransaction(async () => ({
      nested: await db.form.orderBy("id").select(form => ({
        id: form.id,
        labels: form.fields.groupBy("label").orderBy("label").pluck("label"),
        positions: form.fields
          .groupBy("label")
          .orderBy("label")
          .pluck(field => sum(field.position)),
        groups: form.fields.groupBy("label").count(),
      })),
      page: await db.$select({
        groups: totals.orderBy("formId").limit(1),
        groupCount: db.field.groupBy("formId").count(),
      }),
      names: await db.form
        .where(form =>
          form.id.in(
            db.field
              .groupBy("formId")
              .having(() => count().gt(2))
              .pluck("formId"),
          ),
        )
        .pluck("name"),
    }))

    expect(results).toStrictEqual({
      nested: [
        {
          id: 1,
          labels: ["Email", "Name", "Phone"],
          positions: [2, 1, 7],
          groups: 3,
        },
        { id: 2, labels: ["Email", "Name"], positions: [5, 1], groups: 2 },
        { id: 3, labels: [], positions: [], groups: 0 },
      ],
      page: {
        groups: [{ formId: 1, positions: 10, fieldCount: 3 }],
        groupCount: 2,
      },
      names: ["Survey"],
    })
  })

  it("evaluates a condition of the groups of a nested query that reads a column of a parent page after an offset", async () => {
    const page = await testTransaction(
      async () =>
        await db.form
          .orderBy("id")
          .offset(1)
          .select(form => ({
            labels: form.fields
              .groupBy("label")
              .having(() => count().lt(form.threshold))
              .orderBy("label")
              .pluck("label"),
          })),
    )

    expect(page).toStrictEqual([{ labels: ["Email", "Name"] }, { labels: [] }])
  })

  it("takes the other columns of a table grouped by its primary key", async () => {
    const forms = await testTransaction(
      async () => await db.form.groupBy("id").select("id", "name").orderBy("id").limit(1),
    )

    expect(forms).toStrictEqual([{ id: 1, name: "Survey" }])
  })

  describe("what PostgreSQL rejects", () => {
    it("rejects a column outside the keys with SQLSTATE 42803, which names the column", async () => {
      const error: unknown = await testTransaction(
        async () => await db.field.groupBy("formId").select("label"),
      ).catch((caught: unknown) => caught)

      expect(error).toMatchObject({
        code: "42803",
        message: expect.stringContaining('column "form_field.label" must appear'),
      })
    })

    it("rejects a condition of having that reads a key with parameters other than of param through its field, which is a copy whose parameters have numbers of their own", async () => {
      await expect(
        testTransaction(
          async () =>
            await db.field
              .select(field => ({
                bucket: sql(t.integer)`${field.position} % ${2}`,
              }))
              .groupBy((_field, selected) => selected.bucket)
              .having((_field, selected) => selected.bucket.gt(0)),
        ),
      ).rejects.toThrow("must appear in the GROUP BY clause")
    })

    it("rejects an aggregate as a key", async () => {
      await expect(
        testTransaction(
          async () =>
            await db.field
              .select(() => ({
                fieldCount: count(),
              }))
              .groupBy((_field, selected) => selected.fieldCount),
        ),
      ).rejects.toThrow("aggregate functions are not allowed in GROUP BY")
    })
  })
})
