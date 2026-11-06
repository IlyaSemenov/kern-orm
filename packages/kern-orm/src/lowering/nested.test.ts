import { describe, expect, it } from "bun:test"

import { describePostgres } from "../../testing/postgres"
import type { ExpressionNode, ProjectionNode, SelectNode } from "../ast/nodes"
import { createSelectNode } from "../ast/nodes"
import { createDerivedSource, createOrder, createParameter, createRef } from "../ast/testing"
import { compileStatement } from "../compiler/postgres/compile"
import type { TypedExpression } from "../expression/expression"
import { toExpression, toNode } from "../expression/expression"
import { sql } from "../expression/sql"
import { from } from "../query/select"
import { createColumnRefs } from "../query/testing"
import { decodeResult } from "../result/result"
import { defineTable } from "../table/table"
import { defineType } from "../type/type"
import * as t from "../types"

import { packRows, projectRows } from "./nested"
import { lower } from "./testing"

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

const option = defineTable("field_option", {
  id: t.integer,
  fieldId: t.integer.columnName("field_id"),
  value: t.text,
})

/** Query of forms, which nested queries correlate with through `formColumns`. */
const forms = from(form)
const formColumns = createColumnRefs<typeof form>(forms.node.from)
/** Fields of the form of each row of `forms`, which nested queries correlate with through `fieldColumns`. */
const fields = from(field).where(columns => columns.formId.eq(formColumns.id))
const fieldColumns = createColumnRefs<typeof field>(fields.node.from)
const options = from(option).where(columns => columns.fieldId.eq(fieldColumns.id))

/** Query `node` with `changes`, such as an order or a limit. */
function change(node: SelectNode, changes: Partial<SelectNode>): SelectNode {
  return { ...node, ...changes }
}

/** Query `node` with `projections` after its own, such as nested rows. */
function addProjections(node: SelectNode, ...projections: ProjectionNode[]): SelectNode {
  return change(node, { projections: [...node.projections, ...projections] })
}

/** Selects the ids of forms and `projections`, ordered by id. */
function selectForms(...projections: ProjectionNode[]): SelectNode {
  const node = lower(forms.select("id"))
  return change(addProjections(node, ...projections), {
    orderBy: [createOrder(createRef(node.from, "id"))],
  })
}

describe("packRows", () => {
  const allFields = from(field)
  const position = createRef(allFields.node.from, "position")

  it("packs rows in the order of the query, paginating them in a derived source by its sort keys", () => {
    const labels = change(lower(allFields.select("label")), {
      orderBy: [createOrder(position, "desc", "last")],
      limit: createParameter(2),
    })

    expect(compileStatement(packRows(labels)).text).toBe(
      `SELECT coalesce(json_agg(json_build_array(CASE WHEN "subquery"."label" IS NOT DISTINCT FROM NULL THEN NULL ELSE format('%s', "subquery"."label") END) ORDER BY "subquery"."$order1" DESC NULLS LAST), '[]'::json) AS "rows" FROM (SELECT "form_field"."label" AS "label", "form_field"."position" AS "$order1" FROM "form_field" AS "form_field" ORDER BY 2 DESC NULLS LAST LIMIT $1) AS "subquery"`,
    )
  })

  it("orders rows only in the aggregate without a limit or an offset", () => {
    const labels = change(lower(allFields.select("label")), { orderBy: [createOrder(position)] })

    expect(compileStatement(packRows(labels)).text).toBe(
      `SELECT coalesce(json_agg(json_build_array(CASE WHEN "subquery"."label" IS NOT DISTINCT FROM NULL THEN NULL ELSE format('%s', "subquery"."label") END) ORDER BY "subquery"."$order1"), '[]'::json) AS "rows" FROM (SELECT "form_field"."label" AS "label", "form_field"."position" AS "$order1" FROM "form_field" AS "form_field") AS "subquery"`,
    )
  })

  it("packs a query of one row without aggregating it", () => {
    const first = change(lower(allFields.select("label").take()), {
      orderBy: [createOrder(position)],
    })

    expect(compileStatement(packRows(first)).text).toBe(
      `SELECT json_build_array(CASE WHEN "subquery"."label" IS NOT DISTINCT FROM NULL THEN NULL ELSE format('%s', "subquery"."label") END) AS "rows" FROM (SELECT "form_field"."label" AS "label", "form_field"."position" AS "$order1" FROM "form_field" AS "form_field" ORDER BY 2 LIMIT 1) AS "subquery"`,
    )
  })

  it("packs a row without fields as an empty array", () => {
    expect(compileStatement(packRows(lower(allFields.take()))).text).toStartWith(
      'SELECT json_build_array() AS "rows" FROM',
    )
  })

  it("keeps nested rows JSON in a packed row", () => {
    const columns = createColumnRefs<typeof field>(allFields.node.from)
    const values = from(option)
      .where(optionColumns => optionColumns.fieldId.eq(columns.id))
      .pluck("value")
    const withValues = addProjections(lower(allFields), projectRows("values", lower(values)))

    expect(compileStatement(packRows(withValues)).text).toStartWith(
      `SELECT coalesce(json_agg(json_build_array("subquery"."values")), '[]'::json) AS "rows"`,
    )
  })

  it("keeps a derived source of expressions other than table columns apart from the aggregating query", () => {
    const upper = allFields.select(columns => ({
      label: sql(t.text)`upper(${columns.label})`,
    }))
    const labels = createDerivedSource(lower(allFields.select("label")))
    const derivedLabels = createSelectNode(labels, [
      { key: "label", expression: createRef(labels, "label"), type: t.text },
    ])

    expect(compileStatement(packRows(lower(upper))).text).toEndWith(
      `FROM (SELECT upper("form_field"."label") AS "label" FROM "form_field" AS "form_field" OFFSET 0) AS "subquery"`,
    )
    expect(compileStatement(packRows(derivedLabels)).text).toEndWith(
      `FROM (SELECT "subquery_2"."label" AS "label" FROM (SELECT "form_field"."label" AS "label" FROM "form_field" AS "form_field") AS "subquery_2" OFFSET 0) AS "subquery"`,
    )
  })

  it("attaches the result plan of the query to the packed projection", () => {
    const labels = lower(allFields.pluck("label").take().optional())

    expect(packRows(labels).projections).toMatchObject([
      { key: "rows", nested: { fields: labels.projections, rows: "optional", value: true } },
    ])
  })

  it("attaches the conversion of the query to its result plan", () => {
    const labels = lower(allFields.pluck("label"))
    const conversion = { map: String, transform: undefined }

    expect(packRows({ ...labels, conversion }).projections).toMatchObject([
      { key: "rows", nested: { conversion } },
    ])
  })
})

describePostgres("in PostgreSQL", ({ database, testTransaction, useTestFixture }) => {
  /** Composite type `pair` as its text representation. */
  const pair = defineType({ sqlType: "pair" })

  const sample = defineTable("sample", {
    id: t.integer,
    formId: t.integer.columnName("form_id"),
    big: t.bigint.nullable(),
    amount: t.numeric.nullable(),
    at: t.timestamptz.nullable(),
    flag: t.boolean.nullable(),
    code: t.char.with(3).nullable(),
    address: t.inet.nullable(),
    network: t.cidr.nullable(),
    document: t.jsonb.transform({ decode: value => ({ value }) }).nullable(),
    settings: t.json.nullable(),
    pair: pair.nullable(),
    tags: t.array(t.text.nullable()).nullable(),
    bytes: t.bytea.nullable(),
    score: t.integer.transform({ decode: value => `#${value}` }).nullable(),
  })

  useTestFixture(() =>
    // The values of `sample` differ from their casts to text, or lose precision as JSON numbers; a JSON null and a composite of NULL fields are not SQL NULL.
    // `json` has no `=`, which a test for NULL must not need; the second row of `sample` has NULL values, and the third one empty values.
    database.script(`
      CREATE TABLE form (id integer, name text);
      CREATE TABLE form_field (id integer, form_id integer, label text, position integer);
      CREATE TABLE field_option (id integer, field_id integer, value text);
      CREATE TYPE pair AS (a integer, b text);
      CREATE TABLE sample (id integer, form_id integer, big bigint, amount numeric, at timestamptz, flag boolean, code char(3), address inet, network cidr, document jsonb, settings json, pair pair, tags text[], bytes bytea, score integer);
      INSERT INTO form VALUES (1, 'Survey'), (2, 'Feedback'), (3, 'Empty');
      INSERT INTO form_field VALUES (1, 1, 'Name', 1), (2, 1, 'Email', 2), (3, 1, NULL, 3), (4, 2, 'Comment', 1);
      INSERT INTO field_option VALUES (1, 1, 'First'), (2, 1, 'Last'), (3, 4, 'Short');
      INSERT INTO sample VALUES (1, 1, 9007199254740993, 1.000000000000000000000001, '2026-01-15 10:00:00.123456+03', TRUE, 'a', '192.168.0.1/32', '10.0.0.0/8', 'null', '{"b": 1, "a": [true, null]}', ROW(NULL, NULL), '{"a b",NULL}', '\\x00ff', 7), (2, 1, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL), (3, 1, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '{}', '[]', NULL, '{}', '\\x', NULL);
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

  it("decodes nested values as their types decode the values of a row", async () => {
    const samples = from(sample)
    const byId = [createOrder(createRef(samples.node.from, "id"))]
    const formSamples = change(
      lower(samples.select("*").where(columns => columns.formId.eq(formColumns.id))),
      { orderBy: byId },
    )
    const rows = [
      {
        id: 1,
        formId: 1,
        big: 9007199254740993n,
        amount: "1.000000000000000000000001",
        at: "2026-01-15T07:00:00.123456Z",
        flag: true,
        code: "a  ",
        address: "192.168.0.1",
        network: "10.0.0.0/8",
        document: { value: null },
        settings: { b: 1, a: [true, null] },
        pair: "(,)",
        tags: ["a b", null],
        bytes: new Uint8Array([0, 255]),
        score: "#7",
      },
      {
        id: 2,
        formId: 1,
        big: null,
        amount: null,
        at: null,
        flag: null,
        code: null,
        address: null,
        network: null,
        document: null,
        settings: null,
        pair: null,
        tags: null,
        bytes: null,
        score: null,
      },
      {
        id: 3,
        formId: 1,
        big: null,
        amount: null,
        at: null,
        flag: null,
        code: null,
        address: null,
        network: null,
        document: { value: {} },
        settings: [],
        pair: null,
        tags: [],
        bytes: new Uint8Array([]),
        score: null,
      },
    ]

    expect(await execute(change(lower(samples.select("*")), { orderBy: byId }))).toEqual(rows)
    expect(
      await execute(
        change(lower(forms.where({ id: 1 })), {
          projections: [projectRows("samples", formSamples)],
        }),
      ),
    ).toEqual([{ samples: rows }])
  })

  it("tells apart a missing row, a row of NULL values, a row without fields, and no rows", async () => {
    const node = selectForms(
      projectRows(
        "unlabeled",
        lower(fields.select("label").where({ label: null }).take().optional()),
      ),
      projectRows("anyField", lower(fields.take().optional())),
      projectRows("comments", lower(fields.pluck("label").where({ label: "Comment" }))),
      projectRows("rows", lower(fields)),
    )

    expect(await execute(node)).toStrictEqual([
      { id: 1, unlabeled: { label: null }, anyField: {}, comments: [], rows: [{}, {}, {}] },
      { id: 2, unlabeled: undefined, anyField: {}, comments: ["Comment"], rows: [{}] },
      { id: 3, unlabeled: undefined, anyField: undefined, comments: [], rows: [] },
    ])
  })

  // Orchid ORM confused a missing record, NULL, and an empty array of a nested value: https://github.com/romeerez/orchid-orm/issues/830
  it("tells apart a missing row, NULL, and an empty array of a nested value", async () => {
    const tagsOf = (id: number) => lower(from(sample).where({ id }).get("tags").optional())
    const node = change(lower(forms.where({ id: 1 })), {
      projections: [
        projectRows("filledTags", tagsOf(1)),
        projectRows("nullTags", tagsOf(2)),
        projectRows("emptyTags", tagsOf(3)),
        projectRows("missingTags", tagsOf(4)),
      ],
    })

    expect(await execute(node)).toStrictEqual([
      { filledTags: ["a b", null], nullTags: null, emptyTags: [], missingTags: undefined },
    ])
  })

  it("packs nested rows at any depth beside sibling collections", async () => {
    const fieldOptions = change(lower(options.pluck("value")), {
      orderBy: [createOrder(createRef(options.node.from, "id"))],
    })
    const node = selectForms(
      projectRows(
        "fields",
        change(
          addProjections(lower(fields.select("label")), projectRows("options", fieldOptions)),
          {
            orderBy: [createOrder(createRef(fields.node.from, "position"))],
          },
        ),
      ),
      projectRows(
        "positions",
        change(lower(fields.pluck("position")), {
          orderBy: [createOrder(createRef(fields.node.from, "position"), "desc")],
        }),
      ),
    )

    expect(await execute(node)).toEqual([
      {
        id: 1,
        fields: [
          { label: "Name", options: ["First", "Last"] },
          { label: "Email", options: [] },
          { label: null, options: [] },
        ],
        positions: [3, 2, 1],
      },
      { id: 2, fields: [{ label: "Comment", options: ["Short"] }], positions: [1] },
      { id: 3, fields: [], positions: [] },
    ])
  })

  it("orders and paginates the rows of each parent", async () => {
    const node = selectForms(
      projectRows(
        "labels",
        change(lower(fields.pluck("label")), {
          orderBy: [createOrder(createRef(fields.node.from, "label"), "desc", "first")],
          limit: createParameter(2),
        }),
      ),
    )

    expect(await execute(node)).toEqual([
      { id: 1, labels: [null, "Name"] },
      { id: 2, labels: ["Comment"] },
      { id: 3, labels: [] },
    ])
  })

  it("sorts by several keys with their directions and placements of NULL", async () => {
    const labels = lower(from(field).pluck("label"))
    const formId = createRef(labels.from, "formId")
    const label = createRef(labels.from, "label")
    const ascending = change(labels, {
      orderBy: [createOrder(formId), createOrder(label, "desc", "last")],
    })
    const descending = change(labels, {
      orderBy: [createOrder(formId, "desc"), createOrder(label, "asc", "first")],
    })
    /** Query `node` without its first row, limited to two rows. */
    const paginate = (node: SelectNode) =>
      change(node, { offset: createParameter(1), limit: createParameter(2) })
    const node = change(lower(forms.where({ id: 1 })), {
      projections: [
        projectRows("ascending", ascending),
        projectRows("ascendingPage", paginate(ascending)),
        projectRows("descending", descending),
        projectRows("descendingPage", paginate(descending)),
      ],
    })

    expect(await execute(node)).toEqual([
      {
        ascending: ["Name", "Email", null, "Comment"],
        ascendingPage: ["Email", null],
        descending: ["Comment", null, "Email", "Name"],
        descendingPage: [null, "Email"],
      },
    ])
  })

  it("packs a row of more values than a function accepts", async () => {
    const fieldOptions = change(lower(options.pluck("value")), {
      orderBy: [createOrder(createRef(options.node.from, "id"))],
    })
    for (const width of [100, 101]) {
      const keys = Array.from({ length: width - 1 }, (_, index) => `label${index + 1}`)
      const labels = fields.select(columns =>
        Object.fromEntries(keys.map(key => [key, columns.label])),
      )
      const node = selectForms(
        projectRows(
          "fields",
          change(addProjections(lower(labels), projectRows("options", fieldOptions)), {
            orderBy: [createOrder(createRef(fields.node.from, "position"))],
          }),
        ),
      )
      /** Field with `label` under every key and `options`. */
      const createExpectedField = (label: string | null, options: string[]) => ({
        ...Object.fromEntries(keys.map(key => [key, label])),
        options,
      })

      expect(compileStatement(node).text.includes("array_to_json(ARRAY[")).toBe(width > 100)
      expect(await execute(node)).toMatchObject([
        {
          fields: [
            createExpectedField("Name", ["First", "Last"]),
            createExpectedField("Email", []),
            createExpectedField(null, []),
          ],
        },
        { fields: [createExpectedField("Comment", ["Short"])] },
        { fields: [] },
      ])
    }
  })

  it("sorts by an expression with a window function", async () => {
    const node = selectForms(
      projectRows(
        "labels",
        change(lower(fields.pluck("label")), {
          orderBy: [
            createOrder(
              toNode(
                sql`row_number() OVER (ORDER BY ${toExpression(createRef(fields.node.from, "position"))})`,
              ),
              "desc",
            ),
          ],
          limit: createParameter(2),
        }),
      ),
    )

    expect(await execute(node)).toEqual([
      { id: 1, labels: [null, "Email"] },
      { id: 2, labels: ["Comment"] },
      { id: 3, labels: [] },
    ])
  })

  /**
   * Executes forms with the numbers that `value` gives their fields, sorted by `sort` in descending order, and reads how many numbers `sequences` gave.
   *
   * The forms have all numbers, the first one in a limited query, and the first one in a query of one row.
   * The plan is generic, so that PostgreSQL does not see the values of parameters.
   */
  function executeNumbered(
    value: TypedExpression<bigint>,
    sort: ExpressionNode,
    sequences: string[],
  ) {
    const sortOrder = [createOrder(sort, "desc")]
    const numbers = change(lower(fields.pluck(() => value)), { orderBy: sortOrder })
    const node = selectForms(
      projectRows("numbers", numbers),
      projectRows("limited", change(numbers, { limit: createParameter(1) })),
      projectRows(
        "first",
        change(
          lower(
            fields
              .pluck(() => value)
              .take()
              .optional(),
          ),
          { orderBy: sortOrder },
        ),
      ),
    )
    return testTransaction(async () => {
      await database.script(`
        SET LOCAL plan_cache_mode = force_generic_plan;
        ${sequences.map(sequence => `CREATE SEQUENCE ${sequence};`).join("\n")}
      `)
      const compiled = compileStatement(node)
      const { rows } = await database.execute(compiled)
      const counts: number[] = []
      for (const sequence of sequences) {
        counts.push(await database.query`SELECT currval(${sequence})`.get(t.integer))
      }
      const forms = decodeResult(compiled, rows) as {
        numbers: bigint[]
        limited: bigint[]
        first: bigint | undefined
      }[]
      expect(
        forms.map(form => [form.numbers.length, form.limited.length, form.first !== undefined]),
      ).toEqual([
        [3, 1, true],
        [1, 1, true],
        [0, 0, false],
      ])
      return { forms, counts }
    })
  }

  it("evaluates a volatile sort expression once", async () => {
    const { counts } = await executeNumbered(
      sql(t.bigint)`nextval('value_sequence')`,
      toNode(sql`nextval('order_sequence') + ${0}`),
      ["value_sequence", "order_sequence"],
    )

    // Each of the 4 fields gets a sort key in each of the three nested queries; PostgreSQL computes the number of a limited query only for the row it returns.
    expect(counts).toEqual([8, 12])
  })

  it("sorts by a selected volatile expression as by its value", async () => {
    for (const value of [
      sql(t.bigint)`nextval('number_sequence')`,
      sql(t.bigint)`nextval('number_sequence') + ${0}`,
    ]) {
      const { forms, counts } = await executeNumbered(value, toNode(value), ["number_sequence"])

      // Each of the 4 fields gets one number in each of the three nested queries.
      expect(counts).toEqual([12])
      for (const { numbers } of forms) {
        expect(numbers).toEqual(numbers.toSorted((left, right) => (left > right ? -1 : 1)))
      }
    }
  })
})
