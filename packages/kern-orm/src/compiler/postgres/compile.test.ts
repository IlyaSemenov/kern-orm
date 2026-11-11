import { describe, expect, it } from "bun:test"

import { createRecordingDriver } from "../../../testing/database/recording-driver"
import { describePostgres } from "../../../testing/postgres"
import type {
  DeleteNode,
  InsertNode,
  ProjectionNode,
  RawSqlNode,
  SelectNode,
  TableSourceNode,
  UpdateNode,
} from "../../ast/nodes"
import { createNode, createSelectNode, noFilters } from "../../ast/nodes"
import {
  createDerivedSource,
  createExists,
  createInQuery,
  createLeftJoin,
  createOrder,
  createParameter,
  createRef,
  createSubquery,
  createTextSubquery,
} from "../../ast/testing"
import { text } from "../../database/codecs/text"
import { NotFoundError } from "../../database/result"
import { param as paramFragment, sql as sqlFragment } from "../../database/sql/fragment"
import { createDatabase } from "../../execution/database"
import type { AnyExpression, Expression } from "../../expression/expression"
import { toExpression, toNode } from "../../expression/expression"
import { and, not, or } from "../../expression/predicates"
import { param, sql } from "../../expression/sql"
import { lower } from "../../lowering/testing"
import { from } from "../../query/select"
import { createColumnRefs } from "../../query/testing"
import { decodeResult } from "../../result/result"
import { defineSchema } from "../../schema/schema"
import type { AnyTable } from "../../table/table"
import { defineTable } from "../../table/table"
import * as t from "../../types"

import { compileStatement, compileTextStatement } from "./compile"

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

describe("compileStatement", () => {
  it("selects columns by physical name under their keys", () => {
    expect(compileStatement(lower(from(post).select("id", "createdAt"))).text).toBe(
      'SELECT "post"."id" AS "id", "post"."created_at" AS "createdAt" FROM "post" AS "post"',
    )
  })

  it("selects no columns without select", () => {
    const compiled = compileStatement(lower(from(post)))

    expect(compiled.text).toBe('SELECT FROM "post" AS "post"')
    expect(compiled.fields).toEqual([])
  })

  it("selects all columns with *", () => {
    expect(compileStatement(lower(from(post).select("*"))).text).toBe(
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
    const compiled = compileStatement(node)

    expect(compiled).toMatchObject({
      text: 'SELECT "post"."title" AS "title", "post"."title" AS "heading", "post"."title" ILIKE $1 AS "isDraft", upper("post"."title") AS "upper" FROM "post" AS "post"',
      parameters: ["draft%"],
    })
    expect(compiled.fields).toBe(node.projections)
  })

  it("compiles DISTINCT before the projections, numbering parameters in the order of the text", () => {
    const node: SelectNode = {
      ...lower(
        from(post).select(() => ({
          marked: sql(t.text)`${"marked"}`,
        })),
      ),
      distinct: true,
      limit: createParameter(1),
    }

    expect(compileStatement(node)).toMatchObject({
      text: 'SELECT DISTINCT $1 AS "marked" FROM "post" AS "post" LIMIT $2',
      parameters: ["marked", "1"],
    })
  })

  it("rejects a query in an expression, also of the values of IN, which lowering replaces", () => {
    const exists = createNode({
      kind: "nestedQuery",
      query: from(post).exists().node,
      db: undefined,
    })
    const values = createNode({
      kind: "nestedQuery",
      query: from(post).pluck("id").node,
      db: undefined,
    })
    for (const user of [
      exists,
      createNode({ kind: "inQuery", operand: createParameter("post-id"), query: values }),
    ]) {
      const node: SelectNode = { ...lower(from(post)), filters: { user } }

      expect(() => compileStatement(node)).toThrow(
        "A query in an expression must be lowered before compilation",
      )
    }
  })

  it("takes each distinct value of the arguments of an aggregate once", () => {
    const posts = from(post)
    const node: SelectNode = {
      ...lower(posts),
      projections: [
        {
          key: "titleCount",
          expression: createNode({
            kind: "aggregate",
            name: "count",
            distinct: true,
            arguments: [createRef(posts.node.from, "title")],
            orderBy: [],
            filter: undefined,
          }),
          type: t.bigint,
        },
      ],
    }

    expect(compileStatement(node).text).toBe(
      'SELECT count(DISTINCT "post"."title") AS "titleCount" FROM "post" AS "post"',
    )
  })

  it("numbers parameters of selected expressions before those of filters", () => {
    const query = from(post)
      .where({ title: "First" })
      .select(columns => ({
        isDraft: columns.title.eq("Draft"),
      }))

    expect(compileStatement(lower(query))).toMatchObject({
      text: 'SELECT "post"."title" = $1 AS "isDraft" FROM "post" AS "post" WHERE "post"."title" = $2',
      parameters: ["Draft", "First"],
    })
  })

  it("numbers parameters of IN in the order of the text", () => {
    const query = from(post).where(() => param(t.integer, 7).in([8, 9]))

    expect(compileStatement(lower(query))).toMatchObject({
      text: 'SELECT FROM "post" AS "post" WHERE $1::integer IN ($2, $3)',
      parameters: ["7", "8", "9"],
    })
  })

  it("qualifies the table with the PostgreSQL schema", () => {
    expect(compileStatement(lower(from(post).select("id")), { schemaName: "tenant_1" }).text).toBe(
      'SELECT "post"."id" AS "id" FROM "tenant_1"."post" AS "post"',
    )
  })

  it("names a table interpolated into a fragment, qualified with the PostgreSQL schema", () => {
    const query = from(post)
      .select("id")
      .where(() => sql<boolean>`EXISTS (SELECT FROM ${from(form)})`)

    expect(compileStatement(lower(query), { schemaName: "tenant_1" }).text).toBe(
      'SELECT "post"."id" AS "id" FROM "tenant_1"."post" AS "post" WHERE EXISTS (SELECT FROM "tenant_1"."form")',
    )
  })

  it("numbers parameters of raw fragments in statement order", () => {
    const after = new Date("2026-01-01T00:00:00Z")
    const query = from(post)
      .select("id")
      .where({ title: "First" })
      .where(columns => sql<boolean>`${columns.createdAt} > ${after}`)

    expect(compileStatement(lower(query))).toMatchObject({
      text: 'SELECT "post"."id" AS "id" FROM "post" AS "post" WHERE "post"."title" = $1 AND ("post"."created_at" > $2)',
      parameters: ["First", "2026-01-01T00:00:00.000Z"],
    })
  })

  it("parenthesizes a nested OR", () => {
    const query = from(post)
      .select("id")
      .where({ id: "id" })
      .where(columns => or(columns.title.eq("First"), columns.title.eq("Draft")))

    expect(compileStatement(lower(query)).text).toEndWith(
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

    expect(compileStatement(lower(query)).text).toEndWith(
      'WHERE ("post"."title" = $1 OR "post"."title" = $2) = $3 OR ("post"."title" = $4) IS NULL OR (lower("post"."title")) IN ($5)',
    )
  })

  it("parenthesizes operator expressions interpolated into a fragment", () => {
    const query = from(post).where(
      columns => sql`${or(columns.title.eq("First"), columns.title.eq("Draft"))} IS NOT TRUE`,
    )

    expect(compileStatement(lower(query)).text).toEndWith(
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

    expect(compileStatement(lower(query)).text).toEndWith(
      "WHERE $1::integer < $2 AND $3::numeric = $4 AND $5::bpchar = $6",
    )
  })

  it("keeps an expression passed as the value of param with a type", () => {
    const query = from(post).where(() =>
      param(t.jsonb, sql(t.jsonb)`'{"answer":42}'::jsonb`).eq({ answer: 42 }),
    )

    expect(compileStatement(lower(query))).toMatchObject({
      text: expect.stringMatching(/ WHERE \('\{"answer":42\}'::jsonb\) = \$1$/),
      parameters: ['{"answer":42}'],
    })
  })

  it("parenthesizes a cast interpolated into a fragment", () => {
    const query = from(post).where(() => sql`${param(t.array(t.varchar.with(5)), ["a"])}[1] = 'a'`)

    expect(compileStatement(lower(query)).text).toEndWith("WHERE ($1::varchar[])[1] = 'a'")
  })

  it("adds no cast to a parameter of param with an expression", () => {
    const query = from(post).where(columns =>
      and(
        param(columns.title, "First").eq(columns.title),
        param(columns.title, columns.title).eq("First"),
      ),
    )

    expect(compileStatement(lower(query)).text).toEndWith(
      'WHERE $1 = "post"."title" AND "post"."title" = $2',
    )
  })

  // Orchid ORM emitted a dangling OR when an adjacent group became empty: https://github.com/romeerez/orchid-orm/issues/850
  it("compiles empty Boolean groups to valid SQL", () => {
    expect(
      compileStatement(
        lower(
          from(post)
            .select("id")
            .where(() => or()),
        ),
      ).text,
    ).toEndWith("WHERE FALSE")
    expect(compileStatement(lower(from(post).select("id").where({}))).text).not.toContain("WHERE")
  })

  it("compiles NOT before the negated operator", () => {
    const query = from(post)
      .select("id")
      .where(columns => not(columns.title.ilike("draft%")))

    expect(compileStatement(lower(query))).toMatchObject({
      text: 'SELECT "post"."id" AS "id" FROM "post" AS "post" WHERE NOT "post"."title" ILIKE $1',
      parameters: ["draft%"],
    })
  })

  it("rejects an undefined parameter", () => {
    expect(() => compileStatement(lower(from(post).where({ title: undefined })))).toThrow(
      "Query parameter is undefined",
    )
  })

  it("rejects a parameter without a type of a value that only a type encodes, such as an object or an array", () => {
    for (const value of [{ a: 1 }, [1, 2], () => 1]) {
      const node: SelectNode = {
        ...createSelectNode(from(post).node.from),
        limit: createParameter(value),
      }

      expect(() => compileStatement(node)).toThrow("A parameter without a codec takes a string")
    }
  })

  it("rejects a parameter of JSON without a JSON representation", () => {
    for (const value of [() => 1, Symbol("value"), { toJSON: () => undefined }]) {
      expect(() =>
        compileStatement(lower(from(post).where(() => sql`${param(t.jsonb, value)} IS NOT NULL`))),
      ).toThrow(TypeError)
    }
  })

  it("rejects an unknown column of a table, including an inherited property of its columns", () => {
    const source = from(post).node.from
    for (const key of ["missing", "toString"]) {
      const node: SelectNode = {
        ...createSelectNode(source),
        projections: [{ key: "value", expression: createRef(source, key), type: t.text }],
      }

      expect(() => compileStatement(node)).toThrow(`Unknown column "${key}" of table "post"`)
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
      compileStatement(lower(from(post).where(columns => columns.id.eq(foreignId!)))),
    ).toThrow('Column "id" of table "post" refers to a source that is not visible where it is used')
  })
})

describe("nested queries", () => {
  const fields = from(field)
  const fieldColumns = createColumnRefs<typeof field>(fields.node.from)

  // Orchid ORM referred to a missing table alias: https://github.com/romeerez/orchid-orm/issues/855
  it("references the outer source of a correlated subquery by identity", () => {
    const query = forms.select(columns => ({
      name: columns.name,
      fieldCount: createSubquery(lower(fieldCount), t.bigint),
    }))

    expect(compileStatement(lower(query)).text).toBe(
      'SELECT "form"."name" AS "name", (SELECT count(*) AS "count" FROM "form_field" AS "form_field" WHERE "form_field"."form_id" = "form"."id") AS "fieldCount" FROM "form" AS "form"',
    )
  })

  it("compiles EXISTS of a correlated query", () => {
    const query = forms
      .select("id")
      .where(() => not(createExists(lower(formFields.where({ label: null })))))

    expect(compileStatement(lower(query)).text).toBe(
      'SELECT "form"."id" AS "id" FROM "form" AS "form" WHERE NOT EXISTS (SELECT FROM "form_field" AS "form_field" WHERE "form_field"."form_id" = "form"."id" AND "form_field"."label" IS NULL)',
    )
  })

  it("compiles a subquery interpolated into SQL text in parentheses, of any number of fields", () => {
    const query = forms
      .select("id")
      .where(
        () =>
          sql<boolean>`EXISTS ${createTextSubquery(lower(formFields))} AND (${formColumns.id}, ${formColumns.name}) IN ${createTextSubquery(lower(fields.select("formId", "label")))}`,
      )

    expect(compileStatement(lower(query)).text).toBe(
      'SELECT "form"."id" AS "id" FROM "form" AS "form" WHERE EXISTS (SELECT FROM "form_field" AS "form_field" WHERE "form_field"."form_id" = "form"."id") AND ("form"."id", "form"."name") IN (SELECT "form_field_2"."form_id" AS "formId", "form_field_2"."label" AS "label" FROM "form_field" AS "form_field_2")',
    )
  })

  it("gives each occurrence of a query its own sources", () => {
    const query = forms
      .select(() => ({
        fieldCount: createSubquery(lower(fieldCount), t.bigint),
      }))
      .where(() => createExists(lower(fieldCount)))

    expect(compileStatement(lower(query)).text).toBe(
      'SELECT (SELECT count(*) AS "count" FROM "form_field" AS "form_field" WHERE "form_field"."form_id" = "form"."id") AS "fieldCount" FROM "form" AS "form" WHERE EXISTS (SELECT count(*) AS "count" FROM "form_field" AS "form_field_2" WHERE "form_field_2"."form_id" = "form"."id")',
    )
  })

  it("aliases a nested occurrence of a table apart from the outer one", () => {
    const namesakes = from(form).where(columns =>
      and(columns.name.eq(formColumns.name), columns.id.ne(formColumns.id)),
    )
    const query = forms.select("id").where(() => createExists(lower(namesakes)))

    expect(compileStatement(lower(query)).text).toBe(
      'SELECT "form"."id" AS "id" FROM "form" AS "form" WHERE EXISTS (SELECT FROM "form" AS "form_2" WHERE "form_2"."name" = "form"."name" AND "form_2"."id" <> "form"."id")',
    )
  })

  it("qualifies the tables of nested queries with the PostgreSQL schema", () => {
    const query = forms.select(() => ({
      fieldCount: createSubquery(lower(fieldCount), t.bigint),
    }))

    expect(compileStatement(lower(query), { schemaName: "tenant_1" }).text).toBe(
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
          fieldCount: createSubquery(lower(fieldCount), t.bigint),
        })),
      ),
      lower(forms.where(() => createExists(lower(formFields)))),
      { ...lower(forms), joins: [createLeftJoin(fields.node.from)] },
      {
        ...lower(forms),
        joins: [createLeftJoin(createDerivedSource(lower(formFields), { lateral: true }))],
      },
    ]

    expect(compileStatement(lower(forms), {}, tables).text).toBe('SELECT FROM "form" AS "form"')
    for (const node of nodes) {
      expect(() => compileStatement(node, {}, tables)).toThrow(error)
    }
  })

  it("numbers parameters across nested queries in the order of the text", () => {
    const labels = createDerivedSource(
      {
        ...lower(formFields.where({ label: "Lateral" }).select("label")),
        limit: createParameter(2),
      },
      { lateral: true },
    )
    const node: SelectNode = {
      ...lower(
        forms
          .select(columns => ({
            isSurvey: columns.name.eq("Select"),
          }))
          .where({ name: "Where" }),
      ),
      joins: [
        createLeftJoin(labels, toNode(toExpression(createRef(labels, "label"), t.text).eq("On"))),
      ],
      orderBy: [createOrder(toNode(formColumns.name.eq("Order")), "desc")],
      limit: createParameter(10),
      offset: createParameter(20),
    }

    expect(compileStatement(node)).toMatchObject({
      text: 'SELECT "form"."name" = $1 AS "isSurvey" FROM "form" AS "form" LEFT JOIN LATERAL (SELECT "form_field"."label" AS "label" FROM "form_field" AS "form_field" WHERE "form_field"."form_id" = "form"."id" AND "form_field"."label" = $2 LIMIT $3) AS "subquery" ON "subquery"."label" = $4 WHERE "form"."name" = $5 ORDER BY "form"."name" = $6 DESC LIMIT $7 OFFSET $8',
      parameters: ["Select", "Lateral", "2", "On", "Where", "Order", "10", "20"],
    })
  })

  it("rejects a query nested where its source is already visible", () => {
    const query = forms.where(() => createExists(lower(forms.where({ name: "Survey" }))))

    expect(() => compileStatement(lower(query))).toThrow(
      'An occurrence of table "form" appears where it is already visible',
    )
  })

  it("rejects a reference to a source of a nested query", () => {
    const query = forms
      .select(() => ({
        label: fieldColumns.label,
      }))
      .where(() => createExists(lower(fields)))

    expect(() => compileStatement(lower(query))).toThrow(
      'Column "label" of table "form_field" refers to a source that is not visible where it is used',
    )
  })

  it("rejects a reference to a source of a sibling query", () => {
    const query = forms
      .select(() => ({
        fieldCount: createSubquery(
          lower(
            fields.select(() => ({
              count: sql(t.bigint)`count(*)`,
            })),
          ),
          t.bigint,
        ),
      }))
      .where(() =>
        createExists(lower(from(field).where(columns => columns.id.eq(fieldColumns.id)))),
      )

    expect(() => compileStatement(lower(query))).toThrow(
      'Column "id" of table "form_field" refers to a source that is not visible where it is used',
    )
  })

  it("rejects a scalar subquery or a subquery of IN that does not select one field", () => {
    const none = forms.select(() => ({
      value: createSubquery(lower(formFields), t.text),
    }))
    const two = forms.select(() => ({
      value: createSubquery(lower(formFields.select("id", "label")), t.text),
    }))
    const twoOfIn = forms.where(() =>
      createInQuery(toNode(formColumns.id), lower(formFields.select("id", "label"))),
    )

    expect(() => compileStatement(lower(none))).toThrow(
      "A scalar subquery must select one field, not 0",
    )
    expect(() => compileStatement(lower(two))).toThrow(
      "A scalar subquery must select one field, not 2",
    )
    expect(() => compileStatement(lower(twoOfIn))).toThrow(
      "A subquery of IN must select one field, not 2",
    )
  })
})

describe("queries without a source", () => {
  /** Query without `FROM` that selects the expressions of `projections`. */
  function selectWithoutSource(...projections: ProjectionNode[]): SelectNode {
    return { ...lower(from(form)), from: undefined, projections }
  }

  it("selects expressions without FROM", () => {
    const node = selectWithoutSource({
      key: "number",
      expression: toNode(param(t.integer, 1)),
      type: t.integer,
    })

    expect(compileStatement(node)).toMatchObject({
      text: 'SELECT $1::integer AS "number"',
      parameters: ["1"],
    })
  })

  it("resolves column references with the sources of enclosing queries", () => {
    const name = selectWithoutSource({
      key: "name",
      expression: createRef(forms.node.from, "name"),
      type: t.text,
    })
    const query = forms.select(() => ({
      name: createSubquery(name, t.text),
    }))

    expect(compileStatement(lower(query)).text).toBe(
      'SELECT (SELECT "form"."name" AS "name") AS "name" FROM "form" AS "form"',
    )
  })

  it("rejects joins", () => {
    const node: SelectNode = {
      ...selectWithoutSource(),
      joins: [createLeftJoin(from(field).node.from)],
    }

    expect(() => compileStatement(node)).toThrow("A query without FROM cannot join sources")
  })
})

describe("derived sources", () => {
  const captions = createDerivedSource(
    lower(
      from(field).select(columns => ({
        caption: columns.label,
      })),
    ),
  )
  const later = from(field).node.from
  const laterColumns = createColumnRefs<typeof field>(later)

  it("references a derived source by the keys of its projections", () => {
    const node: SelectNode = {
      ...createSelectNode(captions),
      projections: [{ key: "text", expression: createRef(captions, "caption"), type: t.text }],
    }

    expect(compileStatement(node).text).toBe(
      'SELECT "subquery"."caption" AS "text" FROM (SELECT "form_field"."label" AS "caption" FROM "form_field" AS "form_field") AS "subquery"',
    )
  })

  it("references a table that a derived source replaces by the keys of the projections of its query", () => {
    const table = from(post).node.from
    const page = createDerivedSource(
      {
        ...createSelectNode(table, [
          { key: "createdAt", expression: createRef(table, "createdAt"), type: t.timestamptz },
        ]),
        limit: createParameter(20),
      },
      { replaces: table },
    )
    const node: SelectNode = {
      ...createSelectNode(page),
      projections: [{ key: "at", expression: createRef(table, "createdAt"), type: t.timestamptz }],
    }

    expect(compileStatement(node)).toEqual({
      text: 'SELECT "post"."createdAt" AS "at" FROM (SELECT "post_2"."created_at" AS "createdAt" FROM "post" AS "post_2" LIMIT $1) AS "post"',
      parameters: ["20"],
      fields: node.projections,
      rows: "many",
      value: false,
      counted: undefined,
      locksRows: false,
    })
  })

  it("rejects an unknown field of a derived source", () => {
    const node: SelectNode = {
      ...createSelectNode(captions),
      projections: [{ key: "label", expression: createRef(captions, "label"), type: t.text }],
    }

    expect(() => compileStatement(node)).toThrow('Unknown field "label" of a subquery')
  })

  it("hides the sources before a plain derived source from it", () => {
    const node: SelectNode = {
      ...lower(forms),
      joins: [createLeftJoin(createDerivedSource(lower(formFields)))],
    }

    expect(() => compileStatement(node)).toThrow(
      'Column "id" of table "form" refers to a source that is not visible where it is used',
    )
  })

  it("shows the sources before a LATERAL derived source to it", () => {
    const node: SelectNode = {
      ...lower(forms),
      joins: [createLeftJoin(createDerivedSource(lower(formFields), { lateral: true }))],
    }

    expect(compileStatement(node).text).toBe(
      'SELECT FROM "form" AS "form" LEFT JOIN LATERAL (SELECT FROM "form_field" AS "form_field" WHERE "form_field"."form_id" = "form"."id") AS "subquery" ON TRUE',
    )
  })

  it("hides the sources after a LATERAL derived source from it", () => {
    const earlier = createDerivedSource(
      lower(from(form).where(columns => columns.id.eq(laterColumns.formId))),
      { lateral: true },
    )
    const node: SelectNode = {
      ...lower(forms),
      joins: [createLeftJoin(earlier), createLeftJoin(later)],
    }

    expect(() => compileStatement(node)).toThrow(
      'Column "formId" of table "form_field" refers to a source that is not visible where it is used',
    )
  })

  it("shows the sources of enclosing queries to a plain derived source", () => {
    const formLabels = createDerivedSource(lower(formFields.select("label")))
    const labelCount: SelectNode = {
      ...createSelectNode(formLabels),
      projections: [
        {
          key: "count",
          expression: toNode(sql(t.bigint)`count(${toExpression(createRef(formLabels, "label"))})`),
          type: t.bigint,
        },
      ],
    }
    const query = forms.select(() => ({
      labelCount: createSubquery(labelCount, t.bigint),
    }))

    expect(compileStatement(lower(query)).text).toBe(
      'SELECT (SELECT count("subquery"."label") AS "count" FROM (SELECT "form_field"."label" AS "label" FROM "form_field" AS "form_field" WHERE "form_field"."form_id" = "form"."id") AS "subquery") AS "labelCount" FROM "form" AS "form"',
    )
  })

  it("resolves the ON condition of a join with the sources up to the joined one", () => {
    const correlation = toNode(laterColumns.formId.eq(formColumns.id))
    const joined: SelectNode = { ...lower(forms), joins: [createLeftJoin(later, correlation)] }
    const early: SelectNode = {
      ...lower(forms),
      joins: [createLeftJoin(captions, correlation), createLeftJoin(later)],
    }

    expect(compileStatement(joined).text).toBe(
      'SELECT FROM "form" AS "form" LEFT JOIN "form_field" AS "form_field" ON "form_field"."form_id" = "form"."id"',
    )
    expect(() => compileStatement(early)).toThrow(
      'Column "formId" of table "form_field" refers to a source that is not visible where it is used',
    )
  })

  it("gives the sources of a query in two derived sources their own aliases", () => {
    const node: SelectNode = {
      ...lower(forms),
      joins: [
        createLeftJoin(createDerivedSource(lower(formFields), { lateral: true })),
        createLeftJoin(createDerivedSource(lower(formFields), { lateral: true })),
      ],
    }

    expect(compileStatement(node).text).toBe(
      'SELECT FROM "form" AS "form" LEFT JOIN LATERAL (SELECT FROM "form_field" AS "form_field" WHERE "form_field"."form_id" = "form"."id") AS "subquery" ON TRUE LEFT JOIN LATERAL (SELECT FROM "form_field" AS "form_field_2" WHERE "form_field_2"."form_id" = "form"."id") AS "subquery_2" ON TRUE',
    )
  })

  it("rejects a derived source joined twice", () => {
    const source = createDerivedSource(lower(formFields), { lateral: true })
    const node: SelectNode = {
      ...lower(forms),
      joins: [createLeftJoin(source), createLeftJoin(source)],
    }

    expect(() => compileStatement(node)).toThrow(
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
        createOrder(createRef(postSource, "title")),
        createOrder(createRef(postSource, "createdAt"), "desc", "last"),
        createOrder(createRef(postSource, "id"), "asc", "first"),
      ],
    }

    expect(compileStatement(node).text).toBe(
      'SELECT "post"."id" AS "id" FROM "post" AS "post" ORDER BY "post"."title", "post"."created_at" DESC NULLS LAST, "post"."id" NULLS FIRST',
    )
  })

  it("orders and filters the input rows of an aggregate, numbering parameters in the order of the text", () => {
    const fallback = toNode(
      sql`coalesce(${toExpression(createRef(postSource, "title"))}, ${"untitled"})`,
    )
    const node: SelectNode = {
      ...lower(posts),
      projections: [
        {
          key: "titles",
          expression: createNode({
            kind: "aggregate",
            name: "string_agg",
            distinct: false,
            arguments: [createRef(postSource, "title"), createParameter(", ")],
            orderBy: [
              createOrder(fallback, "desc", "last"),
              createOrder(createRef(postSource, "id")),
            ],
            filter: toNode(sql<boolean>`${toExpression(createRef(postSource, "title"))} <> ${""}`),
          }),
          type: t.text,
        },
      ],
    }

    expect(compileStatement(node)).toMatchObject({
      text: 'SELECT string_agg("post"."title", $1 ORDER BY coalesce("post"."title", $2) DESC NULLS LAST, "post"."id") FILTER (WHERE "post"."title" <> $3) AS "titles" FROM "post" AS "post"',
      parameters: [", ", "untitled", ""],
    })
  })

  it("limits and offsets the rows", () => {
    const node: SelectNode = {
      ...lower(posts.select("id")),
      limit: createParameter(10),
      offset: createParameter(20),
    }

    expect(compileStatement(node)).toMatchObject({
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
    const query = forms.where(() => createExists(firstFields))

    expect(compileStatement(lower(query)).text).toBe(
      'SELECT FROM "form" AS "form" WHERE EXISTS (SELECT "form_field"."label" AS "label" FROM "form_field" AS "form_field" WHERE "form_field"."form_id" = "form"."id" LIMIT "form"."id" OFFSET "form"."id")',
    )
    for (const node of [
      { ...lower(forms), limit: toNode(formColumns.id) },
      { ...lower(forms), offset: toNode(formColumns.id) },
    ]) {
      expect(() => compileStatement(node)).toThrow(
        'Column "id" of table "form" refers to a source that is not visible where it is used',
      )
    }
  })
})

describe("groups", () => {
  const posts = from(post)
  const source = posts.node.from
  const title = createRef(source, "title")
  const columns = createColumnRefs<typeof post>(source)

  it("compiles a key as the position of the projection of the same column or expression node, and another key as its expression", () => {
    const shifted = toNode(sql(t.text)`${columns.title} || ${"x"}`)
    const node: SelectNode = {
      ...createSelectNode(source, [
        { key: "shifted", expression: shifted, type: t.text },
        { key: "heading", expression: title, type: t.text },
      ]),
      groupBy: [title, shifted, createRef(source, "id")],
    }

    expect(compileStatement(node).text).toBe(
      'SELECT "post"."title" || $1 AS "shifted", "post"."title" AS "heading" FROM "post" AS "post" GROUP BY 2, 1, "post"."id"',
    )
  })

  it("does not take an equal expression built apart for the projection of a key", () => {
    const node: SelectNode = {
      ...createSelectNode(source, [
        {
          key: "shifted",
          expression: toNode(sql(t.text)`${columns.title} || ${"x"}`),
          type: t.text,
        },
      ]),
      groupBy: [toNode(sql(t.text)`${columns.title} || ${"x"}`)],
    }

    expect(compileStatement(node)).toMatchObject({
      text: 'SELECT "post"."title" || $1 AS "shifted" FROM "post" AS "post" GROUP BY "post"."title" || $2',
      parameters: ["x", "x"],
    })
  })

  it("binds the parameter of a cast once at every place of a query of groups, and at each place elsewhere", () => {
    const zone = param(t.text, "UTC")
    const day = sql(t.text)`${columns.createdAt} at time zone ${zone}`
    const shifted = sql(t.text)`${columns.title} || ${"x"}`
    const inner = from(post).node.from
    const innerColumns = createColumnRefs<typeof post>(inner)
    const nested = createSubquery(
      createSelectNode(inner, [
        {
          key: "day",
          expression: toNode(sql(t.text)`${innerColumns.createdAt} at time zone ${zone}`),
          type: t.text,
        },
      ]),
      t.text,
    )
    const node: SelectNode = {
      ...createSelectNode(source, [{ key: "nested", expression: toNode(nested), type: t.text }]),
      groupBy: [toNode(day), toNode(shifted)],
      having: toNode(sql<boolean>`${day} > ${zone} OR ${shifted} > ${"y"}`),
      orderBy: [createOrder(toNode(day)), createOrder(toNode(shifted))],
    }

    expect(compileStatement(node)).toMatchObject({
      text: 'SELECT (SELECT "post_2"."created_at" at time zone ($1::text) AS "day" FROM "post" AS "post_2") AS "nested" FROM "post" AS "post" GROUP BY "post"."created_at" at time zone ($2::text), "post"."title" || $3 HAVING "post"."created_at" at time zone ($2::text) > ($2::text) OR "post"."title" || $4 > $5 ORDER BY "post"."created_at" at time zone ($2::text), "post"."title" || $6',
      parameters: ["UTC", "UTC", "x", "x", "y", "x"],
    })
    expect(
      compileStatement({
        ...createSelectNode(source),
        filters: { user: toNode(sql<boolean>`${day} = ${day}`) },
      }).parameters,
    ).toEqual(["UTC", "UTC"])
  })

  it("binds the parameter of param of the database layer once at every place of a query of groups, and at each place elsewhere", () => {
    const zone = paramFragment(text, "UTC")
    const day = sql(t.text)`${columns.createdAt} at time zone ${zone}`
    const node: SelectNode = {
      ...createSelectNode(source, [{ key: "day", expression: toNode(day), type: t.text }]),
      groupBy: [toNode(sql`${columns.createdAt} at time zone ${zone}`)],
      having: toNode(sql<boolean>`${day} > ${sqlFragment`${zone} || ${"x"}`}`),
    }

    expect(compileStatement(node)).toMatchObject({
      text: 'SELECT "post"."created_at" at time zone ($1::text) AS "day" FROM "post" AS "post" GROUP BY "post"."created_at" at time zone ($1::text) HAVING "post"."created_at" at time zone ($1::text) > ($1::text) || $2',
      parameters: ["UTC", "x"],
    })
    expect(
      compileStatement({
        ...createSelectNode(source),
        filters: { user: toNode(sql<boolean>`${day} = ${day}`) },
      }).parameters,
    ).toEqual(["UTC", "UTC"])
  })

  it("numbers the parameters in the order of the text, with the clauses after WHERE and before ORDER BY", () => {
    const node: SelectNode = {
      ...createSelectNode(source, [
        { key: "selected", expression: toNode(sql(t.text)`${"selected"}`), type: t.text },
      ]),
      filters: { user: toNode(columns.title.eq("where")) },
      groupBy: [toNode(sql`${columns.title} || ${"group"}`)],
      having: toNode(sql<boolean>`${columns.title} = ${"having"}`),
      orderBy: [createOrder(toNode(sql`${columns.title} || ${"order"}`))],
      limit: createParameter(1),
    }

    expect(compileStatement(node)).toMatchObject({
      text: 'SELECT $1 AS "selected" FROM "post" AS "post" WHERE "post"."title" = $2 GROUP BY "post"."title" || $3 HAVING "post"."title" = $4 ORDER BY "post"."title" || $5 LIMIT $6',
      parameters: ["selected", "where", "group", "having", "order", "1"],
    })
  })

  it("sees the sources of its query and of enclosing queries, and rejects a source elsewhere in the statement", () => {
    const inner = from(post).node.from
    const nested = (changes: Partial<SelectNode>) =>
      toNode(
        createSubquery(
          {
            ...createSelectNode(inner, [
              { key: "id", expression: createRef(inner, "id"), type: t.uuid },
            ]),
            ...changes,
          },
          t.uuid,
        ),
      )
    const outer = (changes: Partial<SelectNode>) =>
      createSelectNode(source, [{ key: "nested", expression: nested(changes), type: t.uuid }])
    const elsewhere = createRef(from(post).node.from, "id")

    expect(compileStatement(outer({ groupBy: [title], having: title })).text).toContain(
      'GROUP BY "post"."title" HAVING "post"."title"',
    )
    expect(() => compileStatement(outer({ groupBy: [elsewhere] }))).toThrow()
    expect(() => compileStatement(outer({ having: elsewhere }))).toThrow()
  })
})

describe("keys of DISTINCT ON", () => {
  const source = from(post).node.from
  const title = createRef(source, "title")
  const columns = createColumnRefs<typeof post>(source)

  it("compiles a key as the position of the projection of the same column or expression node, and another key as its expression, before the select list in the order of the parameters", () => {
    const shifted = toNode(sql(t.text)`${columns.title} || ${"x"}`)
    const node: SelectNode = {
      ...createSelectNode(source, [
        { key: "shifted", expression: shifted, type: t.text },
        { key: "heading", expression: title, type: t.text },
        { key: "suffix", expression: toNode(sql(t.text)`${"y"}`), type: t.text },
      ]),
      distinctOn: [title, shifted, toNode(sql(t.text)`${columns.id} || ${"z"}`)],
    }

    expect(compileStatement(node)).toMatchObject({
      text: 'SELECT DISTINCT ON (2, 1, "post"."id" || $1) "post"."title" || $2 AS "shifted", "post"."title" AS "heading", $3 AS "suffix" FROM "post" AS "post"',
      parameters: ["z", "x", "y"],
    })
  })
})

describe("row locks", () => {
  const posts = from(post)

  it("writes the lock after the limit and the offset, with what the statement does with a locked row", () => {
    const page = {
      ...lower(posts.select("id")),
      limit: createParameter(1),
      offset: createParameter(2),
    }

    expect(
      compileStatement({ ...page, lock: { strength: "UPDATE", onLocked: undefined } }).text,
    ).toBe('SELECT "post"."id" AS "id" FROM "post" AS "post" LIMIT $1 OFFSET $2 FOR UPDATE')
    expect(
      compileStatement({ ...page, lock: { strength: "NO KEY UPDATE", onLocked: "NOWAIT" } }).text,
    ).toBe(
      'SELECT "post"."id" AS "id" FROM "post" AS "post" LIMIT $1 OFFSET $2 FOR NO KEY UPDATE NOWAIT',
    )
    expect(
      compileStatement({ ...page, lock: { strength: "KEY SHARE", onLocked: "SKIP LOCKED" } }).text,
    ).toBe(
      'SELECT "post"."id" AS "id" FROM "post" AS "post" LIMIT $1 OFFSET $2 FOR KEY SHARE SKIP LOCKED',
    )
  })

  it("tells that a select statement locks rows at any depth, unlike a mutation, which may change them under the lock", () => {
    const lock = { strength: "UPDATE", onLocked: undefined } as const
    const locked = { ...lower(from(post).select("id")), lock }
    const nested: SelectNode = {
      ...lower(posts),
      projections: [
        {
          key: "value",
          expression: toNode(createSubquery(locked, t.uuid)),
          type: t.uuid,
        },
      ],
    }

    expect(compileStatement(lower(posts.select("id"))).locksRows).toBe(false)
    expect(compileStatement(locked).locksRows).toBe(true)
    expect(compileStatement(nested).locksRows).toBe(true)
    expect(
      compileStatement({
        kind: "update",
        target: posts.node.from,
        set: [{ key: "title", value: toNode(createSubquery(locked, t.uuid)) }],
        filters: noFilters,
        returning: undefined,
        rows: "many",
        value: false,
      }).locksRows,
    ).toBe(false)
  })
})

describe("mutations", () => {
  const target = from(form).node.from
  const name = createRef(target, "name")
  const returning: ProjectionNode[] = [
    { key: "id", expression: createRef(target, "id"), type: t.integer },
  ]

  it("compiles an insert of rows of VALUES with DEFAULT for a missing value, numbering parameters in the order of the text", () => {
    const node: InsertNode = {
      kind: "insert",
      target,
      columns: ["name", "id"],
      values: [
        [createParameter("Survey"), undefined],
        [createParameter("Feedback"), createParameter(2)],
      ],
      returning: [
        ...returning,
        {
          key: "label",
          expression: toNode(sql(t.text)`${toExpression(name)} || ${"!"}`),
          type: t.text,
        },
      ],
      rows: "many",
      value: false,
    }

    expect(compileStatement(node, { schemaName: "app" })).toMatchObject({
      text: 'INSERT INTO "app"."form" AS "form" ("name", "id") VALUES ($1, DEFAULT), ($2, $3) RETURNING "form"."id" AS "id", "form"."name" || $4 AS "label"',
      parameters: ["Survey", "Feedback", "2", "!"],
      fields: node.returning,
      rows: "many",
      counted: undefined,
    })
  })

  it("names the physical columns of an insert and an update", () => {
    const insert: InsertNode = {
      kind: "insert",
      target: from(field).node.from,
      columns: ["formId"],
      values: [[createParameter(1)]],
      returning: undefined,
      rows: "one",
      value: false,
    }
    const update: UpdateNode = {
      kind: "update",
      target: from(field).node.from,
      set: [{ key: "formId", value: createParameter(1) }],
      filters: noFilters,
      returning: undefined,
      rows: "many",
      value: false,
    }

    expect(compileStatement(insert).text).toBe(
      'INSERT INTO "form_field" AS "form_field" ("form_id") VALUES ($1)',
    )
    expect(compileStatement(update).text).toBe(
      'UPDATE "form_field" AS "form_field" SET "form_id" = $1',
    )
  })

  it("compiles ON CONFLICT of an insert, naming the physical columns of its key, before RETURNING", () => {
    const node: InsertNode = {
      kind: "insert",
      target: from(field).node.from,
      columns: ["id", "formId"],
      values: [[createParameter(1), createParameter(2)]],
      conflict: { target: ["id", "formId"] },
      returning: undefined,
      rows: "optional",
      value: false,
    }

    expect(compileStatement(node).text).toBe(
      'INSERT INTO "form_field" AS "form_field" ("id", "form_id") VALUES ($1, $2) ON CONFLICT ("id", "form_id") DO NOTHING',
    )
    expect(
      compileStatement({
        ...node,
        conflict: { target: [] },
        returning: [{ key: "id", expression: createRef(node.target, "id"), type: t.integer }],
      }).text,
    ).toBe(
      'INSERT INTO "form_field" AS "form_field" ("id", "form_id") VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING "form_field"."id" AS "id"',
    )
  })

  it("compiles DO UPDATE of ON CONFLICT, whose values see the existing row and the inserted row as excluded", () => {
    const excluded: TableSourceNode = { kind: "table", table: form }
    const node: InsertNode = {
      kind: "insert",
      target,
      columns: ["id", "name"],
      values: [[createParameter(1), createParameter("Survey")]],
      conflict: {
        target: ["id"],
        update: {
          set: [
            {
              key: "name",
              value: toNode(
                sql`${toExpression(name)} || ${toExpression(createRef(excluded, "name"))}`,
              ),
            },
          ],
          excluded,
        },
      },
      returning: undefined,
      rows: "one",
      value: false,
    }

    expect(compileStatement(node).text).toBe(
      'INSERT INTO "form" AS "form" ("id", "name") VALUES ($1, $2) ON CONFLICT ("id") DO UPDATE SET "name" = "form"."name" || "excluded"."name"',
    )
  })

  it("compiles the target of the row of a singleton table as the expression of its unique index", () => {
    const excluded: TableSourceNode = { kind: "table", table: form }
    const node: InsertNode = {
      kind: "insert",
      target,
      columns: ["name"],
      values: [[createParameter("Survey")]],
      conflict: {
        target: "singleton",
        update: { set: [{ key: "name", value: createRef(excluded, "name") }], excluded },
      },
      returning: undefined,
      rows: "one",
      value: false,
    }

    expect(compileStatement(node).text).toBe(
      'INSERT INTO "form" AS "form" ("name") VALUES ($1) ON CONFLICT ((true)) DO UPDATE SET "name" = "excluded"."name"',
    )
  })

  it("keeps the alias excluded of DO UPDATE from a table of that name", () => {
    const table = defineTable("excluded", {
      id: t.integer.primaryKey(),
    })
    const occurrence: TableSourceNode = { kind: "table", table }
    const excluded: TableSourceNode = { kind: "table", table }
    const node: InsertNode = {
      kind: "insert",
      target: occurrence,
      columns: ["id"],
      values: [[createParameter(1)]],
      conflict: {
        target: ["id"],
        update: {
          set: [{ key: "id", value: createRef(excluded, "id") }],
          excluded,
        },
      },
      returning: [{ key: "id", expression: createRef(occurrence, "id"), type: t.integer }],
      rows: "one",
      value: false,
    }

    expect(compileStatement(node).text).toBe(
      'INSERT INTO "excluded" AS "excluded_2" ("id") VALUES ($1) ON CONFLICT ("id") DO UPDATE SET "id" = "excluded"."id" RETURNING "excluded_2"."id" AS "id"',
    )
  })

  it("compiles DEFAULT VALUES for one row without columns and rejects several such rows", () => {
    const node: InsertNode = {
      kind: "insert",
      target,
      columns: [],
      values: [[]],
      returning: undefined,
      rows: "one",
      value: false,
    }

    expect(compileStatement(node).text).toBe('INSERT INTO "form" AS "form" DEFAULT VALUES')
    expect(() => compileStatement({ ...node, values: [[], []] })).toThrow(
      "An insert of several rows must list a column",
    )
  })

  it("compiles an update and a delete of the rows of their filters, whose expressions see the occurrence of the table", () => {
    const filters = { user: toNode(toExpression<string>(name, t.text).eq("Survey")) }
    const update: UpdateNode = {
      kind: "update",
      target,
      set: [
        { key: "name", value: toNode(sql`upper(${toExpression(name)})`) },
        { key: "id", value: createParameter(2) },
      ],
      filters,
      returning,
      rows: "many",
      value: false,
    }
    const remove: DeleteNode = {
      kind: "delete",
      target,
      filters,
      returning,
      rows: "many",
      value: false,
    }

    expect(compileStatement(update)).toMatchObject({
      text: 'UPDATE "form" AS "form" SET "name" = upper("form"."name"), "id" = $1 WHERE "form"."name" = $2 RETURNING "form"."id" AS "id"',
      parameters: ["2", "Survey"],
    })
    expect(compileStatement(remove)).toMatchObject({
      text: 'DELETE FROM "form" AS "form" WHERE "form"."name" = $1 RETURNING "form"."id" AS "id"',
      parameters: ["Survey"],
    })
  })

  it("omits RETURNING of a mutation that returns no fields, which counts its rows", () => {
    const node: DeleteNode = {
      kind: "delete",
      target,
      filters: noFilters,
      returning: undefined,
      rows: "one",
      value: false,
    }

    expect(compileStatement(node)).toMatchObject({
      text: 'DELETE FROM "form" AS "form"',
      fields: [],
      rows: "one",
      counted: "number",
    })
    expect(compileStatement({ ...node, returning: [] })).toMatchObject({
      text: 'DELETE FROM "form" AS "form"',
      fields: [],
      counted: "records",
    })
  })

  it("rejects a value of an insert that refers to its table, and a table outside the tables of the statement", () => {
    const node: InsertNode = {
      kind: "insert",
      target,
      columns: ["name"],
      values: [[name]],
      returning: undefined,
      rows: "one",
      value: false,
    }

    expect(() => compileStatement(node)).toThrow(
      'Column "name" of table "form" refers to a source that is not visible where it is used',
    )
    expect(() =>
      compileStatement({ ...node, values: [[createParameter("Survey")]] }, {}, new Set([post])),
    ).toThrow('Table "form" is not part of the schema')
  })
})

describe("statements of SQL text", () => {
  /** SQL text of `fragment`. */
  function toRawSql(fragment: AnyExpression): RawSqlNode {
    return toNode(fragment) as RawSqlNode
  }

  it("compiles the text with the parameters of its values and the names of its tables", () => {
    const node = toRawSql(sql`DELETE FROM ${from(form)} WHERE name = ${"Survey"}`)

    expect(compileTextStatement(node, { schemaName: "app" })).toEqual({
      text: 'DELETE FROM "app"."form" WHERE name = $1',
      parameters: ["Survey"],
    })
    expect(compileTextStatement(node).text).toBe('DELETE FROM "form" WHERE name = $1')
  })

  it("rejects a table outside the tables of the statement, and a table bound to a Db other than the one that runs it", () => {
    const schema = defineSchema({ form })
    const database = createDatabase({ driver: createRecordingDriver().driver })
    const db = database.bind(schema)
    const otherDb = database.bind(schema)
    const node = toRawSql(sql`SELECT FROM ${db.form}`)

    expect(compileTextStatement(node, {}, new Set<AnyTable>([form]), db).text).toBe(
      'SELECT FROM "form"',
    )
    expect(() =>
      compileTextStatement(toRawSql(sql`SELECT FROM ${from(post)}`), {}, new Set([form])),
    ).toThrow('Table "post" is not part of the schema')
    expect(() => compileTextStatement(node, {}, new Set<AnyTable>([form]), otherDb)).toThrow(
      'Table "form" interpolated into SQL is bound to another Db',
    )
    expect(() => compileTextStatement(node)).toThrow(
      'Table "form" interpolated into SQL is bound to a Db, so only that Db can compile the query',
    )
  })
})

describePostgres("in PostgreSQL", ({ database, testTransaction, useTestFixture }) => {
  /** Forms in a table whose name takes the whole length of an identifier. */
  const longForm = defineTable("x".repeat(63), {
    id: t.integer,
    name: t.text,
  })

  useTestFixture(() =>
    database.script(`
      CREATE TABLE form (id integer, name text);
      CREATE TABLE "${longForm.name}" (id integer, name text);
      INSERT INTO "${longForm.name}" VALUES (1, 'Survey'), (2, 'Survey'), (3, 'Feedback');
      CREATE TABLE form_field (id integer, form_id integer, label text, position integer);
      INSERT INTO form VALUES (1, 'Survey'), (2, 'Feedback'), (3, 'Empty');
      INSERT INTO form_field VALUES (1, 1, 'Name', 1), (2, 1, 'Email', 2), (3, 1, NULL, 3), (4, 2, 'Comment', 1);
    `),
  )

  /** Compiles a query, executes it in a test transaction of its own, and decodes its rows. */
  function execute(node: SelectNode) {
    return testTransaction(async () => {
      const compiled = compileStatement(node)
      const { rows } = await database.execute(compiled)
      return decodeResult(compiled, rows)
    })
  }

  it("executes queries of values, keeping NULL values", async () => {
    const labels = from(field).where({ formId: 1 }).pluck("label")

    expect(
      await execute({
        ...lower(labels),
        orderBy: [createOrder(createRef(labels.node.from, "position"))],
      }),
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
    const firstFields = createDerivedSource({
      ...lower(formFields.select("label")),
      orderBy: [createOrder(createRef(formFields.node.from, "position"))],
      limit: toNode(formColumns.id),
    })
    const firstLabels: SelectNode = {
      ...createSelectNode(firstFields),
      projections: [
        {
          key: "labels",
          expression: toNode(
            sql(t.text)`string_agg(${toExpression(createRef(firstFields, "label"))}, ${", "})`,
          ),
          type: t.text,
        },
      ],
    }
    const query = forms
      .select(columns => ({
        name: columns.name,
        fieldCount: createSubquery(lower(fieldCount), t.bigint),
        hasUnlabeled: createExists(lower(formFields.where({ label: null }))),
        firstLabels: createSubquery(firstLabels, t.text),
      }))
      .where(columns => columns.name.ne("Archived"))

    expect(
      await execute({ ...lower(query), orderBy: [createOrder(createRef(forms.node.from, "id"))] }),
    ).toEqual([
      { name: "Survey", fieldCount: 3n, hasUnlabeled: true, firstLabels: "Name" },
      { name: "Feedback", fieldCount: 1n, hasUnlabeled: false, firstLabels: "Comment" },
      { name: "Empty", fieldCount: 0n, hasUnlabeled: false, firstLabels: null },
    ])
  })

  it("executes a LATERAL join paginated per row of its source", async () => {
    const lastFields = createDerivedSource(
      {
        ...lower(formFields.select("label", "position")),
        orderBy: [createOrder(createRef(formFields.node.from, "position"), "desc")],
        limit: createParameter(2),
        offset: createParameter(1),
      },
      { lateral: true },
    )
    const node: SelectNode = {
      ...lower(
        forms.select(columns => ({
          form: columns.name,
          label: toExpression(createRef(lastFields, "label"), t.text),
        })),
      ),
      joins: [createLeftJoin(lastFields)],
      orderBy: [
        createOrder(createRef(forms.node.from, "id")),
        createOrder(createRef(lastFields, "position"), "desc", "last"),
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
    const query = outer.select("id").where(() => createExists(lower(namesakes)))

    expect(
      await execute({ ...lower(query), orderBy: [createOrder(createRef(outer.node.from, "id"))] }),
    ).toEqual([{ id: 1 }, { id: 2 }])
  })

  it("tells apart fields of a derived source whose keys differ only after 63 bytes", async () => {
    const idKey = `${"k".repeat(63)}_id`
    const nameKey = `${"k".repeat(63)}_name`
    const longFields = createDerivedSource({
      ...lower(forms),
      projections: [
        { key: idKey, expression: toNode(formColumns.id), type: t.integer },
        { key: nameKey, expression: toNode(formColumns.name), type: t.text },
      ],
    })
    const node: SelectNode = {
      ...createSelectNode(longFields),
      projections: [
        { key: "id", expression: createRef(longFields, idKey), type: t.integer },
        { key: "name", expression: createRef(longFields, nameKey), type: t.text },
      ],
      orderBy: [createOrder(createRef(longFields, idKey))],
    }

    expect(await execute(node)).toEqual([
      { id: 1, name: "Survey" },
      { id: 2, name: "Feedback" },
      { id: 3, name: "Empty" },
    ])
  })
})
