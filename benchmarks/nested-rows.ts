// Data and SQL shared by the benchmarks of packed nested rows: parents with nested rows whose fields cycle over common column types.

import * as t from "kern-orm/types"

import type { Run } from "./harness"

const parents = Number(process.env.PARENTS ?? 1000)
const fanout = Number(process.env.FANOUT ?? 10)

/** Types of the fields of nested rows, cycled over the fields: the SQL type, SQL that generates the value of row `id`, and the type that decodes it. */
const kinds = [
  { sql: "integer", generate: (id: string) => `(${id} * 7) % 100000`, type: t.integer },
  { sql: "text", generate: (id: string) => `'label ' || ${id}`, type: t.text },
  {
    sql: "timestamptz",
    generate: (id: string) =>
      `timestamptz '2026-01-01 00:00:00.123456+00' + ${id} * interval '1 second'`,
    type: t.timestamptz,
  },
  {
    sql: "numeric",
    generate: (id: string) => `(${id}::numeric / 7)::numeric(20,6)`,
    type: t.numeric,
  },
  { sql: "boolean", generate: (id: string) => `${id} % 2 = 0`, type: t.boolean },
  {
    sql: "text",
    generate: (id: string) => `CASE WHEN ${id} % 3 = 0 THEN NULL ELSE 'note ' || ${id} END`,
    type: t.text,
  },
]

/** Field of nested rows. */
export interface Field {
  readonly name: string
  readonly kind: (typeof kinds)[number]
}

/** Table of nested rows, with a column `parent_id` that refers to `parent` and a column `position` that orders the rows of a parent. */
export interface NestedTable {
  readonly name: string
  readonly fields: readonly Field[]
}

/**
 * Creates the temporary table `parent` and three tables of nested rows, of 3, 10, and 30 fields, with the same number of nested rows for each parent.
 *
 * `PARENTS` and `FANOUT` change the number of parents, 1000 by default, and of nested rows of each, 10 by default.
 */
export async function createNestedTables(run: Run): Promise<NestedTable[]> {
  await run("CREATE TEMP TABLE parent (id integer PRIMARY KEY)")
  await run(`INSERT INTO parent SELECT id FROM generate_series(1, ${parents}) AS id`)
  await run("ANALYZE parent")
  const tables: NestedTable[] = []
  for (const width of [3, 10, 30]) {
    const fields: Field[] = []
    for (let index = 0; index < width; index++) {
      fields.push({
        name: `field_${String(index + 1).padStart(2, "0")}`,
        kind: kinds[index % kinds.length]!,
      })
    }
    const name = `child_${width}`
    await run(
      `CREATE TEMP TABLE ${name} (id integer PRIMARY KEY, parent_id integer, position integer, ${fields.map(field => `${field.name} ${field.kind.sql}`).join(", ")})`,
    )
    await run(
      `INSERT INTO ${name} SELECT id, (id - 1) / ${fanout} + 1, id % ${fanout}, ${fields.map(field => field.kind.generate("id")).join(", ")} FROM generate_series(1, ${parents * fanout}) AS id`,
    )
    await run(`CREATE INDEX ON ${name} (parent_id)`)
    await run(`ANALYZE ${name}`)
    tables.push({ name, fields })
  }
  return tables
}

/** Builds the query of the nested rows `c` of the parent `p` in `table` that selects `projections`, followed by `suffix`, such as `OFFSET 0`. */
export function selectNested(table: NestedTable, projections: string[], suffix?: string): string {
  const text = `SELECT ${projections.join(", ")} FROM ${table.name} AS c WHERE c.parent_id = p.id`
  return suffix === undefined ? text : `${text} ${suffix}`
}

/** Builds the query of parents with their rows of the query `nested`, read as `s`, packed by the SQL `row` in the order of the SQL `order`. */
export function selectParents(nested: string, row: string, order: string): string {
  return `SELECT p.id, (SELECT coalesce(json_agg(${row} ORDER BY ${order}), '[]'::json) FROM (${nested}) AS s) AS items FROM parent AS p`
}

/** Builds the SQL of a packed row of `fields` read from `s`, a positional JSON array. */
export function packRow(fields: readonly Field[]): string {
  return `json_build_array(${fields.map(field => packValue(`s.${field.name}`)).join(", ")})`
}

/** Builds the SQL that packing uses for a scalar: its PostgreSQL text representation, or `NULL`. */
export function packValue(ref: string): string {
  return `CASE WHEN ${ref} IS NOT DISTINCT FROM NULL THEN NULL ELSE format('%s', ${ref}) END`
}
