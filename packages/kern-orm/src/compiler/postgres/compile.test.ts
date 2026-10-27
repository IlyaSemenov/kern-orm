import { describe, expect, it } from "bun:test"

import { describePostgres } from "../../../testing/postgres"
import type { SelectNode } from "../../ast/nodes"
import { createNode, createSelectNode } from "../../ast/nodes"
import { derived, exists, leftJoin, orderBy, parameter, ref, subquery } from "../../ast/testing"
import type { Expression } from "../../expression/expression"
import { toExpression, toNode } from "../../expression/expression"
import { and, not, or } from "../../expression/predicates"
import { param, sql } from "../../expression/sql"
import { lower } from "../../lowering/testing"
import { createColumnRefs } from "../../query/column-refs"
import { from } from "../../query/select"
import { decodeResult, NotFoundError } from "../../result/result"
import type { AnyTable } from "../../table/table"
import { defineTable } from "../../table/table"
import * as t from "../../types"

import { compileSelect } from "./compile"

const post = defineTable("post", {
  id: t.uuid,
  title: t.text,
  createdAt: t.timestamptz.columnName("created_at"),
})

const form = defineTable("form", {
  id: t.integer,
  name: t.text,
})

const field = defineTable("form_field", {
  id: t.integer,
  formId: t.integer.columnName("form_id"),
  label: t.text.nullable(),
  position: t.integer,
})

/** Query of forms, which nested queries correlate with through `formColumns`. */
const forms = from(form)
const formColumns = createColumnRefs<typeof form>(forms.node.from)
/** Fields of the form of each row of `forms`. */
const formFields = from(field).where(columns => columns.formId.eq(formColumns.id))
const fieldCount = formFields.select(() => ({
  count: sql(t.bigint)`count(*)`,
}))

describe("compileSelect", () => {
  it("selects columns by physical name under their keys", () => {
    expect(compileSelect(lower(from(post).select("id", "createdAt"))).text).toBe(
      'SELECT "post"."id" AS "id", "post"."created_at" AS "createdAt" FROM "post" AS "post"',
    )
  })

  it("selects no columns without select", () => {
    const compiled = compileSelect(lower(from(post)))

    expect(compiled.text).toBe('SELECT FROM "post" AS "post"')
    expect(compiled.fields).toEqual([])
  })

  it("selects all columns with *", () => {
    expect(compileSelect(lower(from(post).select("*"))).text).toBe(
      'SELECT "post"."id" AS "id", "post"."title" AS "title", "post"."created_at" AS "createdAt" FROM "post" AS "post"',
    )
  })

  it("selects expressions under their keys, returning the projections as the result fields", () => {
    const query = from(post).select(columns => ({
      title: columns.title,
      heading: columns.title,
      isDraft: columns.title.ilike("draft%"),
      upper: sql(t.text)`upper(${columns.title})`,
    }))
    const node = lower(query)
    const compiled = compileSelect(node)

    expect(compiled).toMatchObject({
      text: 'SELECT "post"."title" AS "title", "post"."title" AS "heading", "post"."title" ILIKE $1 AS "isDraft", upper("post"."title") AS "upper" FROM "post" AS "post"',
      parameters: ["draft%"],
    })
    expect(compiled.fields).toBe(node.projections)
  })

  it("numbers parameters of selected expressions before those of filters", () => {
    const query = from(post)
      .where({ title: "First" })
      .select(columns => ({
        isDraft: columns.title.eq("Draft"),
      }))

    expect(compileSelect(lower(query))).toMatchObject({
      text: 'SELECT "post"."title" = $1 AS "isDraft" FROM "post" AS "post" WHERE "post"."title" = $2',
      parameters: ["Draft", "First"],
    })
  })

  it("numbers parameters of IN in the order of the text", () => {
    const query = from(post).where(() => param(t.integer, 7).in([8, 9]))

    expect(compileSelect(lower(query))).toMatchObject({
      text: 'SELECT FROM "post" AS "post" WHERE $1::integer IN ($2, $3)',
      parameters: ["7", "8", "9"],
    })
  })

  it("qualifies the table with the PostgreSQL schema", () => {
    expect(compileSelect(lower(from(post).select("id")), { schemaName: "tenant_1" }).text).toBe(
      'SELECT "post"."id" AS "id" FROM "tenant_1"."post" AS "post"',
    )
  })

  it("numbers parameters of raw fragments in statement order", () => {
    const after = new Date("2026-01-01T00:00:00Z")
    const query = from(post)
      .select("id")
      .where({ title: "First" })
      .where(columns => sql<boolean>`${columns.createdAt} > ${after}`)

    expect(compileSelect(lower(query))).toMatchObject({
      text: 'SELECT "post"."id" AS "id" FROM "post" AS "post" WHERE "post"."title" = $1 AND ("post"."created_at" > $2)',
      parameters: ["First", "2026-01-01T00:00:00.000Z"],
    })
  })

  it("parenthesizes a nested OR", () => {
    const query = from(post)
      .select("id")
      .where({ id: "id" })
      .where(columns => or(columns.title.eq("First"), columns.title.eq("Draft")))

    expect(compileSelect(lower(query)).text).toEndWith(
      'WHERE "post"."id" = $1 AND ("post"."title" = $2 OR "post"."title" = $3)',
    )
  })

  it("parenthesizes composite operands of comparisons, IN, and IS NULL", () => {
    const query = from(post).where(columns =>
      or(
        or(columns.title.eq("First"), columns.title.eq("Draft")).eq(false),
        columns.title.eq("First").isNull(),
        sql<string>`lower(${columns.title})`.in(["first"]),
      ),
    )

    expect(compileSelect(lower(query)).text).toEndWith(
      'WHERE ("post"."title" = $1 OR "post"."title" = $2) = $3 OR ("post"."title" = $4) IS NULL OR (lower("post"."title")) IN ($5)',
    )
  })

  it("parenthesizes operator expressions interpolated into a fragment", () => {
    const query = from(post).where(
      columns => sql`${or(columns.title.eq("First"), columns.title.eq("Draft"))} IS NOT TRUE`,
    )

    expect(compileSelect(lower(query)).text).toEndWith(
      'WHERE ("post"."title" = $1 OR "post"."title" = $2) IS NOT TRUE',
    )
  })

  it("casts a parameter of param to its type without type parameters", () => {
    const query = from(post).where(() =>
      and(
        param(t.integer, 2).lt(10),
        param(t.numeric.with(10, 2), "1.005").eq("1.005"),
        param(t.char.with(3), "abcd").eq("abcd"),
      ),
    )

    expect(compileSelect(lower(query)).text).toEndWith(
      "WHERE $1::integer < $2 AND $3::numeric = $4 AND $5::bpchar = $6",
    )
  })

  it("keeps an expression passed as the value of param with a type", () => {
    const query = from(post).where(() =>
      param(t.jsonb, sql(t.jsonb)`'{"answer":42}'::jsonb`).eq({ answer: 42 }),
    )

    expect(compileSelect(lower(query))).toMatchObject({
      text: expect.stringMatching(/ WHERE \('\{"answer":42\}'::jsonb\) = \$1$/),
      parameters: ['{"answer":42}'],
    })
  })

  it("parenthesizes a cast interpolated into a fragment", () => {
    const query = from(post).where(() => sql`${param(t.array(t.varchar.with(5)), ["a"])}[1] = 'a'`)

    expect(compileSelect(lower(query)).text).toEndWith("WHERE ($1::varchar[])[1] = 'a'")
  })

  it("adds no cast to a parameter of param with an expression", () => {
    const query = from(post).where(columns =>
      and(
        param(columns.title, "First").eq(columns.title),
        param(columns.title, columns.title).eq("First"),
      ),
    )

    expect(compileSelect(lower(query)).text).toEndWith(
      'WHERE $1 = "post"."title" AND "post"."title" = $2',
    )
  })

  // Orchid ORM emitted a dangling OR when an adjacent group became empty: https://github.com/romeerez/orchid-orm/issues/850
  it("compiles empty Boolean groups to valid SQL", () => {
    expect(
      compileSelect(
        lower(
          from(post)
            .select("id")
            .where(() => or()),
        ),
      ).text,
    ).toEndWith("WHERE FALSE")
    expect(compileSelect(lower(from(post).select("id").where({}))).text).not.toContain("WHERE")
  })

  it("compiles NOT before the negated operator", () => {
    const query = from(post)
      .select("id")
      .where(columns => not(columns.title.ilike("draft%")))

    expect(compileSelect(lower(query))).toMatchObject({
      text: 'SELECT "post"."id" AS "id" FROM "post" AS "post" WHERE NOT "post"."title" ILIKE $1',
      parameters: ["draft%"],
    })
  })

  it("rejects an undefined parameter", () => {
    expect(() => compileSelect(lower(from(post).where({ title: undefined })))).toThrow(
      "Query parameter is undefined",
    )
  })

  it("rejects a parameter without a JSON representation", () => {
    const values = [() => 1, Symbol("value"), { toJSON: () => undefined }]
    for (const value of values) {
      expect(() => compileSelect(lower(from(post).where(() => sql`${value} IS NOT NULL`)))).toThrow(
        TypeError,
      )
      expect(() =>
        compileSelect(lower(from(post).where(() => sql`${param(t.jsonb, value)} IS NOT NULL`))),
      ).toThrow(TypeError)
    }
  })

  it("rejects an unknown column of a table, including an inherited property of its columns", () => {
    const source = from(post).node.from
    for (const key of ["missing", "toString"]) {
      const node: SelectNode = {
        ...createSelectNode(source),
        projections: [{ key: "value", expression: ref(source, key), type: t.text }],
      }

      expect(() => compileSelect(node)).toThrow(`Unknown column "${key}" of table "post"`)
    }
  })

  it("rejects a column of a source outside the query", () => {
    const other = from(post)
    let foreignId: Expression<string> | undefined
    other.where(columns => {
      foreignId = columns.id
      return columns.id.eq("id")
    })

    expect(() =>
      compileSelect(lower(from(post).where(columns => columns.id.eq(foreignId!)))),
    ).toThrow('Column "id" of table "post" refers to a source that is not visible where it is used')
  })

  // Orchid ORM let a user OR bypass the relation condition: https://github.com/romeerez/orchid-orm/issues/845
  it.todo("never makes a relation condition an operand of a user OR")
})

describe("nested queries", () => {
  const fields = from(field)
  const fieldColumns = createColumnRefs<typeof field>(fields.node.from)

  // Orchid ORM referred to a missing table alias: https://github.com/romeerez/orchid-orm/issues/855
  it("references the outer source of a correlated subquery by identity", () => {
    const query = forms.select(columns => ({
      name: columns.name,
      fieldCount: subquery(lower(fieldCount), t.bigint),
    }))

    expect(compileSelect(lower(query)).text).toBe(
      'SELECT "form"."name" AS "name", (SELECT count(*) AS "count" FROM "form_field" AS "form_field" WHERE "form_field"."form_id" = "form"."id") AS "fieldCount" FROM "form" AS "form"',
    )
  })

  it("compiles EXISTS of a correlated query", () => {
    const query = forms
      .select("id")
      .where(() => not(exists(lower(formFields.where({ label: null })))))

    expect(compileSelect(lower(query)).text).toBe(
      'SELECT "form"."id" AS "id" FROM "form" AS "form" WHERE NOT EXISTS (SELECT FROM "form_field" AS "form_field" WHERE "form_field"."form_id" = "form"."id" AND "form_field"."label" IS NULL)',
    )
  })

  it("gives each occurrence of a query its own sources", () => {
    const query = forms
      .select(() => ({
        fieldCount: subquery(lower(fieldCount), t.bigint),
      }))
      .where(() => exists(lower(fieldCount)))

    expect(compileSelect(lower(query)).text).toBe(
      'SELECT (SELECT count(*) AS "count" FROM "form_field" AS "form_field" WHERE "form_field"."form_id" = "form"."id") AS "fieldCount" FROM "form" AS "form" WHERE EXISTS (SELECT count(*) AS "count" FROM "form_field" AS "form_field_2" WHERE "form_field_2"."form_id" = "form"."id")',
    )
  })

  it("aliases a nested occurrence of a table apart from the outer one", () => {
    const namesakes = from(form).where(columns =>
      and(columns.name.eq(formColumns.name), columns.id.ne(formColumns.id)),
    )
    const query = forms.select("id").where(() => exists(lower(namesakes)))

    expect(compileSelect(lower(query)).text).toBe(
      'SELECT "form"."id" AS "id" FROM "form" AS "form" WHERE EXISTS (SELECT FROM "form" AS "form_2" WHERE "form_2"."name" = "form"."name" AND "form_2"."id" <> "form"."id")',
    )
  })

  it("qualifies the tables of nested queries with the PostgreSQL schema", () => {
    const query = forms.select(() => ({
      fieldCount: subquery(lower(fieldCount), t.bigint),
    }))

    expect(compileSelect(lower(query), { schemaName: "tenant_1" }).text).toBe(
      'SELECT (SELECT count(*) AS "count" FROM "tenant_1"."form_field" AS "form_field" WHERE "form_field"."form_id" = "form"."id") AS "fieldCount" FROM "tenant_1"."form" AS "form"',
    )
  })

  it("rejects an occurrence of a table outside the allowed tables at any depth", () => {
    const tables = new Set<AnyTable>([form])
    const error = 'Table "form_field" is not part of the schema'
    const nodes: SelectNode[] = [
      lower(from(field)),
      lower(
        forms.select(() => ({
          fieldCount: subquery(lower(fieldCount), t.bigint),
        })),
      ),
      lower(forms.where(() => exists(lower(formFields)))),
      { ...lower(forms), joins: [leftJoin(fields.node.from)] },
      { ...lower(forms), joins: [leftJoin(derived(lower(formFields), true))] },
    ]

    expect(compileSelect(lower(forms), {}, tables).text).toBe('SELECT FROM "form" AS "form"')
    for (const node of nodes) {
      expect(() => compileSelect(node, {}, tables)).toThrow(error)
    }
  })

  it("numbers parameters across nested queries in the order of the text", () => {
    const labels = derived(
      { ...lower(formFields.where({ label: "Lateral" }).select("label")), limit: parameter(2) },
      true,
    )
    const node: SelectNode = {
      ...lower(
        forms
          .select(columns => ({
            isSurvey: columns.name.eq("Select"),
          }))
          .where({ name: "Where" }),
      ),
      joins: [leftJoin(labels, toNode(toExpression(ref(labels, "label"), t.text).eq("On")))],
      orderBy: [orderBy(toNode(formColumns.name.eq("Order")), "desc")],
      limit: parameter(10),
      offset: parameter(20),
    }

    expect(compileSelect(node)).toMatchObject({
      text: 'SELECT "form"."name" = $1 AS "isSurvey" FROM "form" AS "form" LEFT JOIN LATERAL (SELECT "form_field"."label" AS "label" FROM "form_field" AS "form_field" WHERE "form_field"."form_id" = "form"."id" AND "form_field"."label" = $2 LIMIT $3) AS "subquery" ON "subquery"."label" = $4 WHERE "form"."name" = $5 ORDER BY "form"."name" = $6 DESC LIMIT $7 OFFSET $8',
      parameters: ["Select", "Lateral", "2", "On", "Where", "Order", "10", "20"],
    })
  })

  it("rejects a query nested where its source is already visible", () => {
    const query = forms.where(() => exists(lower(forms.where({ name: "Survey" }))))

    expect(() => compileSelect(lower(query))).toThrow(
      'An occurrence of table "form" appears where it is already visible',
    )
  })

  it("rejects a reference to a source of a nested query", () => {
    const query = forms
      .select(() => ({
        label: fieldColumns.label,
      }))
      .where(() => exists(lower(fields)))

    expect(() => compileSelect(lower(query))).toThrow(
      'Column "label" of table "form_field" refers to a source that is not visible where it is used',
    )
  })

  it("rejects a reference to a source of a sibling query", () => {
    const query = forms
      .select(() => ({
        fieldCount: subquery(
          lower(
            fields.select(() => ({
              count: sql(t.bigint)`count(*)`,
            })),
          ),
          t.bigint,
        ),
      }))
      .where(() => exists(lower(from(field).where(columns => columns.id.eq(fieldColumns.id)))))

    expect(() => compileSelect(lower(query))).toThrow(
      'Column "id" of table "form_field" refers to a source that is not visible where it is used',
    )
  })

  it("rejects a scalar subquery that does not select one field", () => {
    const none = forms.select(() => ({
      value: subquery(lower(formFields), t.text),
    }))
    const two = forms.select(() => ({
      value: subquery(lower(formFields.select("id", "label")), t.text),
    }))

    expect(() => compileSelect(lower(none))).toThrow(
      "A scalar subquery must select one field, not 0",
    )
    expect(() => compileSelect(lower(two))).toThrow(
      "A scalar subquery must select one field, not 2",
    )
  })
})

describe("derived sources", () => {
  const captions = derived(
    lower(
      from(field).select(columns => ({
        caption: columns.label,
      })),
    ),
    false,
  )
  const later = from(field).node.from
  const laterColumns = createColumnRefs<typeof field>(later)

  it("references a derived source by the keys of its projections", () => {
    const node: SelectNode = {
      ...createSelectNode(captions),
      projections: [{ key: "text", expression: ref(captions, "caption"), type: t.text }],
    }

    expect(compileSelect(node).text).toBe(
      'SELECT "subquery"."caption" AS "text" FROM (SELECT "form_field"."label" AS "caption" FROM "form_field" AS "form_field") AS "subquery"',
    )
  })

  it("rejects an unknown field of a derived source", () => {
    const node: SelectNode = {
      ...createSelectNode(captions),
      projections: [{ key: "label", expression: ref(captions, "label"), type: t.text }],
    }

    expect(() => compileSelect(node)).toThrow('Unknown field "label" of a subquery')
  })

  it("hides the sources before a plain derived source from it", () => {
    const node: SelectNode = {
      ...lower(forms),
      joins: [leftJoin(derived(lower(formFields), false))],
    }

    expect(() => compileSelect(node)).toThrow(
      'Column "id" of table "form" refers to a source that is not visible where it is used',
    )
  })

  it("shows the sources before a LATERAL derived source to it", () => {
    const node: SelectNode = {
      ...lower(forms),
      joins: [leftJoin(derived(lower(formFields), true))],
    }

    expect(compileSelect(node).text).toBe(
      'SELECT FROM "form" AS "form" LEFT JOIN LATERAL (SELECT FROM "form_field" AS "form_field" WHERE "form_field"."form_id" = "form"."id") AS "subquery" ON TRUE',
    )
  })

  it("hides the sources after a LATERAL derived source from it", () => {
    const earlier = derived(
      lower(from(form).where(columns => columns.id.eq(laterColumns.formId))),
      true,
    )
    const node: SelectNode = { ...lower(forms), joins: [leftJoin(earlier), leftJoin(later)] }

    expect(() => compileSelect(node)).toThrow(
      'Column "formId" of table "form_field" refers to a source that is not visible where it is used',
    )
  })

  it("shows the sources of enclosing queries to a plain derived source", () => {
    const formLabels = derived(lower(formFields.select("label")), false)
    const labelCount: SelectNode = {
      ...createSelectNode(formLabels),
      projections: [
        {
          key: "count",
          expression: toNode(sql(t.bigint)`count(${toExpression(ref(formLabels, "label"))})`),
          type: t.bigint,
        },
      ],
    }
    const query = forms.select(() => ({
      labelCount: subquery(labelCount, t.bigint),
    }))

    expect(compileSelect(lower(query)).text).toBe(
      'SELECT (SELECT count("subquery"."label") AS "count" FROM (SELECT "form_field"."label" AS "label" FROM "form_field" AS "form_field" WHERE "form_field"."form_id" = "form"."id") AS "subquery") AS "labelCount" FROM "form" AS "form"',
    )
  })

  it("resolves the ON condition of a join with the sources up to the joined one", () => {
    const correlation = toNode(laterColumns.formId.eq(formColumns.id))
    const joined: SelectNode = { ...lower(forms), joins: [leftJoin(later, correlation)] }
    const early: SelectNode = {
      ...lower(forms),
      joins: [leftJoin(captions, correlation), leftJoin(later)],
    }

    expect(compileSelect(joined).text).toBe(
      'SELECT FROM "form" AS "form" LEFT JOIN "form_field" AS "form_field" ON "form_field"."form_id" = "form"."id"',
    )
    expect(() => compileSelect(early)).toThrow(
      'Column "formId" of table "form_field" refers to a source that is not visible where it is used',
    )
  })

  it("gives the sources of a query in two derived sources their own aliases", () => {
    const node: SelectNode = {
      ...lower(forms),
      joins: [
        leftJoin(derived(lower(formFields), true)),
        leftJoin(derived(lower(formFields), true)),
      ],
    }

    expect(compileSelect(node).text).toBe(
      'SELECT FROM "form" AS "form" LEFT JOIN LATERAL (SELECT FROM "form_field" AS "form_field" WHERE "form_field"."form_id" = "form"."id") AS "subquery" ON TRUE LEFT JOIN LATERAL (SELECT FROM "form_field" AS "form_field_2" WHERE "form_field_2"."form_id" = "form"."id") AS "subquery_2" ON TRUE',
    )
  })

  it("rejects a derived source joined twice", () => {
    const source = derived(lower(formFields), true)
    const node: SelectNode = { ...lower(forms), joins: [leftJoin(source), leftJoin(source)] }

    expect(() => compileSelect(node)).toThrow(
      "An occurrence of a subquery appears where it is already visible",
    )
  })
})

describe("ordering and pagination", () => {
  const posts = from(post)
  const postSource = posts.node.from

  it("orders by expressions with their directions and placement of NULL", () => {
    const node: SelectNode = {
      ...lower(posts.select("id")),
      orderBy: [
        orderBy(ref(postSource, "title")),
        orderBy(ref(postSource, "createdAt"), "desc", "last"),
        orderBy(ref(postSource, "id"), "asc", "first"),
      ],
    }

    expect(compileSelect(node).text).toBe(
      'SELECT "post"."id" AS "id" FROM "post" AS "post" ORDER BY "post"."title", "post"."created_at" DESC NULLS LAST, "post"."id" NULLS FIRST',
    )
  })

  it("orders the input rows of an aggregate, numbering parameters in the order of the text", () => {
    const fallback = toNode(sql`coalesce(${toExpression(ref(postSource, "title"))}, ${"untitled"})`)
    const node: SelectNode = {
      ...lower(posts),
      projections: [
        {
          key: "titles",
          expression: createNode({
            kind: "aggregate",
            name: "string_agg",
            arguments: [ref(postSource, "title"), parameter(", ")],
            orderBy: [orderBy(fallback, "desc", "last"), orderBy(ref(postSource, "id"))],
          }),
          type: t.text,
        },
      ],
    }

    expect(compileSelect(node)).toMatchObject({
      text: 'SELECT string_agg("post"."title", $1 ORDER BY coalesce("post"."title", $2) DESC NULLS LAST, "post"."id") AS "titles" FROM "post" AS "post"',
      parameters: [", ", "untitled"],
    })
  })

  it("limits and offsets the rows", () => {
    const node: SelectNode = {
      ...lower(posts.select("id")),
      limit: parameter(10),
      offset: parameter(20),
    }

    expect(compileSelect(node)).toMatchObject({
      text: 'SELECT "post"."id" AS "id" FROM "post" AS "post" LIMIT $1 OFFSET $2',
      parameters: ["10", "20"],
    })
  })

  it("resolves LIMIT and OFFSET with the sources of enclosing queries only", () => {
    const firstFields: SelectNode = {
      ...lower(formFields.select("label")),
      limit: toNode(formColumns.id),
      offset: toNode(formColumns.id),
    }
    const query = forms.where(() => exists(firstFields))

    expect(compileSelect(lower(query)).text).toBe(
      'SELECT FROM "form" AS "form" WHERE EXISTS (SELECT "form_field"."label" AS "label" FROM "form_field" AS "form_field" WHERE "form_field"."form_id" = "form"."id" LIMIT "form"."id" OFFSET "form"."id")',
    )
    for (const node of [
      { ...lower(forms), limit: toNode(formColumns.id) },
      { ...lower(forms), offset: toNode(formColumns.id) },
    ]) {
      expect(() => compileSelect(node)).toThrow(
        'Column "id" of table "form" refers to a source that is not visible where it is used',
      )
    }
  })
})

describePostgres("in PostgreSQL", ({ database, testTransaction, useTestFixture, runStatement }) => {
  /** Forms in a table whose name takes the whole length of an identifier. */
  const longForm = defineTable("x".repeat(63), {
    id: t.integer,
    name: t.text,
  })

  useTestFixture(async () => {
    await runStatement("CREATE TABLE form (id integer, name text)")
    await runStatement(`CREATE TABLE "${longForm.name}" (id integer, name text)`)
    await runStatement(
      `INSERT INTO "${longForm.name}" VALUES (1, 'Survey'), (2, 'Survey'), (3, 'Feedback')`,
    )
    await runStatement(
      "CREATE TABLE form_field (id integer, form_id integer, label text, position integer)",
    )
    await runStatement("INSERT INTO form VALUES (1, 'Survey'), (2, 'Feedback'), (3, 'Empty')")
    await runStatement(
      "INSERT INTO form_field VALUES (1, 1, 'Name', 1), (2, 1, 'Email', 2), (3, 1, NULL, 3), (4, 2, 'Comment', 1)",
    )
  })

  /** Compiles a query, executes it in a test transaction of its own, and decodes its rows. */
  function execute(node: SelectNode) {
    return testTransaction(async () => {
      const compiled = compileSelect(node)
      const { rows } = await database.execute(compiled)
      return decodeResult(compiled, rows)
    })
  }

  it("executes queries of values, keeping NULL values", async () => {
    const labels = from(field).where({ formId: 1 }).pluck("label")

    expect(
      await execute({ ...lower(labels), orderBy: [orderBy(ref(labels.node.from, "position"))] }),
    ).toEqual(["Name", "Email", null])
    expect(await execute(lower(from(field).where({ id: 5 }).pluck("label")))).toEqual([])
  })

  it("executes queries of one row, telling a NULL value from a missing row", async () => {
    const labels = from(field).get("label")

    expect(await execute(lower(from(field).select("formId").where({ formId: 1 }).take()))).toEqual({
      formId: 1,
    })
    expect(await execute(lower(labels.where({ id: 3 })))).toBeNull()
    expect(await execute(lower(labels.where({ id: 5 }).optional()))).toBeUndefined()
    await expect(execute(lower(labels.where({ id: 5 })))).rejects.toThrow(NotFoundError)
  })

  it("executes correlated subqueries", async () => {
    // As many labels in the order of fields as the id of the form, which only an enclosing query can limit them by.
    const firstFields = derived(
      {
        ...lower(formFields.select("label")),
        orderBy: [orderBy(ref(formFields.node.from, "position"))],
        limit: toNode(formColumns.id),
      },
      false,
    )
    const firstLabels: SelectNode = {
      ...createSelectNode(firstFields),
      projections: [
        {
          key: "labels",
          expression: toNode(
            sql(t.text)`string_agg(${toExpression(ref(firstFields, "label"))}, ${", "})`,
          ),
          type: t.text,
        },
      ],
    }
    const query = forms
      .select(columns => ({
        name: columns.name,
        fieldCount: subquery(lower(fieldCount), t.bigint),
        hasUnlabeled: exists(lower(formFields.where({ label: null }))),
        firstLabels: subquery(firstLabels, t.text),
      }))
      .where(columns => columns.name.ne("Archived"))

    expect(
      await execute({ ...lower(query), orderBy: [orderBy(ref(forms.node.from, "id"))] }),
    ).toEqual([
      { name: "Survey", fieldCount: 3n, hasUnlabeled: true, firstLabels: "Name" },
      { name: "Feedback", fieldCount: 1n, hasUnlabeled: false, firstLabels: "Comment" },
      { name: "Empty", fieldCount: 0n, hasUnlabeled: false, firstLabels: null },
    ])
  })

  it("executes a LATERAL join paginated per row of its source", async () => {
    const lastFields = derived(
      {
        ...lower(formFields.select("label", "position")),
        orderBy: [orderBy(ref(formFields.node.from, "position"), "desc")],
        limit: parameter(2),
        offset: parameter(1),
      },
      true,
    )
    const node: SelectNode = {
      ...lower(
        forms.select(columns => ({
          form: columns.name,
          label: toExpression(ref(lastFields, "label"), t.text),
        })),
      ),
      joins: [leftJoin(lastFields)],
      orderBy: [
        orderBy(ref(forms.node.from, "id")),
        orderBy(ref(lastFields, "position"), "desc", "last"),
      ],
    }

    expect(await execute(node)).toEqual([
      { form: "Survey", label: "Email" },
      { form: "Survey", label: "Name" },
      { form: "Feedback", label: null },
      { form: "Empty", label: null },
    ])
  })

  it("tells apart nested occurrences of a table whose name takes 63 bytes", async () => {
    const outer = from(longForm)
    const outerColumns = createColumnRefs<typeof longForm>(outer.node.from)
    const namesakes = from(longForm).where(columns =>
      and(columns.name.eq(outerColumns.name), columns.id.ne(outerColumns.id)),
    )
    const query = outer.select("id").where(() => exists(lower(namesakes)))

    expect(
      await execute({ ...lower(query), orderBy: [orderBy(ref(outer.node.from, "id"))] }),
    ).toEqual([{ id: 1 }, { id: 2 }])
  })

  it("tells apart fields of a derived source whose keys differ only after 63 bytes", async () => {
    const idKey = `${"k".repeat(63)}_id`
    const nameKey = `${"k".repeat(63)}_name`
    const longFields = derived(
      {
        ...lower(forms),
        projections: [
          { key: idKey, expression: toNode(formColumns.id), type: t.integer },
          { key: nameKey, expression: toNode(formColumns.name), type: t.text },
        ],
      },
      false,
    )
    const node: SelectNode = {
      ...createSelectNode(longFields),
      projections: [
        { key: "id", expression: ref(longFields, idKey), type: t.integer },
        { key: "name", expression: ref(longFields, nameKey), type: t.text },
      ],
      orderBy: [orderBy(ref(longFields, idKey))],
    }

    expect(await execute(node)).toEqual([
      { id: 1, name: "Survey" },
      { id: 2, name: "Feedback" },
      { id: 3, name: "Empty" },
    ])
  })
})
