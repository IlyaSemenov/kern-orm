// Fixtures of the tests of the helpers in PostgreSQL: a schema that steps change, as the target schema of a migration, and a description of its structure.
import type { Database } from "kern-orm"
import * as t from "kern-orm/types"

import type { MigrationStep } from "../migration"
import { runChange } from "../migration"

/** PostgreSQL schema that `inHelperSchema` creates. */
export const helperSchema = "migrations_helpers"

/**
 * Creates PostgreSQL schema `migrations_helpers` and runs `callback` in a nested transaction whose unqualified names resolve in it, as those of a migration resolve in its target schema.
 *
 * Call it in a test transaction, which drops the schema.
 */
export async function inHelperSchema<T>(
  database: Database,
  callback: () => Promise<T>,
): Promise<T> {
  await database.script(`CREATE SCHEMA ${helperSchema}`)
  return await database.transaction(callback, { searchPath: [helperSchema] })
}

/** Structure of a schema before a step, after its `up`, and after its `down`. */
export interface AppliedStep {
  readonly before: string[]
  readonly up: string[]
  readonly down: string[]
}

/**
 * Runs `setup` and then the `up` and the `down` of `step` in schema `migrations_helpers`, and describes the schema before `up`, after it, and after `down`.
 *
 * Call it in a test transaction.
 */
export async function applyStep(
  database: Database,
  step: MigrationStep,
  setup?: string,
): Promise<AppliedStep> {
  return await inHelperSchema(database, async () => {
    if (setup !== undefined) {
      await database.script(setup)
    }
    const before = await describeSchema(database)
    await runChange(database, step.up)
    const up = await describeSchema(database)
    if (step.down !== undefined) {
      await runChange(database, step.down)
    }
    return { before, up, down: await describeSchema(database) }
  })
}

/**
 * Describes the columns, constraints, and indexes of the tables of schema `migrations_helpers`, one line each, in order.
 *
 * It leaves out the `NOT NULL` constraints of PostgreSQL 18, which the lines of columns show.
 */
export async function describeSchema(database: Database): Promise<string[]> {
  return await database.query`
    SELECT line FROM (
      SELECT format(
        'column %s.%s %s%s%s',
        class.relname,
        attribute.attname,
        format_type(attribute.atttypid, attribute.atttypmod),
        CASE WHEN attribute.attnotnull THEN ' NOT NULL' ELSE '' END,
        ' DEFAULT ' || pg_get_expr(def.adbin, def.adrelid)
      ) AS line
      FROM pg_catalog.pg_class AS class
      JOIN pg_catalog.pg_attribute AS attribute ON attribute.attrelid = class.oid AND attribute.attnum > 0 AND NOT attribute.attisdropped
      LEFT JOIN pg_catalog.pg_attrdef AS def ON def.adrelid = class.oid AND def.adnum = attribute.attnum
      WHERE class.relnamespace = ${helperSchema}::regnamespace AND class.relkind = 'r'
      UNION ALL
      SELECT format('constraint %s.%s %s', class.relname, con.conname, pg_get_constraintdef(con.oid))
      FROM pg_catalog.pg_constraint AS con
      JOIN pg_catalog.pg_class AS class ON class.oid = con.conrelid
      WHERE class.relnamespace = ${helperSchema}::regnamespace AND con.contype <> 'n'
      UNION ALL
      SELECT format('index %s', indexdef) FROM pg_catalog.pg_indexes WHERE schemaname = ${helperSchema}
    ) AS lines
    ORDER BY line
  `.pluck(t.text)
}
