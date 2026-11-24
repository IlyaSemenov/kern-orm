// Exports custom types, queries of SQL text, and the columns of a table from a module that imports only the root of `kern-orm` and `kern-orm/types`, as a module of presets does.
// The package test emits its declarations in a program of its own of a consumer that cannot resolve kern-db, where they name the types of kern-db through the root of `kern-orm`.
import type { Database, RecordOf } from "kern-orm"
import { columnsOf, defineTable, defineType, orderingOperators, textOperators } from "kern-orm"
import * as t from "kern-orm/types"

/** Custom type with the operators of text; see the file header. */
export const email = defineType({ sqlType: "citext" }).withOperators({
  ...orderingOperators,
  ...textOperators,
})

/** Custom type of another representation of its values, with type parameters; see the file header. */
export const vector = defineType({ sqlType: "vector" })
  .transform({
    decode: text => JSON.parse(text) as number[],
    encode: (value: number[]) => JSON.stringify(value),
  })
  .withParameters((dimensions: number) => `vector(${dimensions})`)

/** Query of SQL text, whose declaration names the query of kern-db; see the file header. */
export function countForms(database: Database) {
  return database.query`SELECT count(*) FROM form`.get(t.integer)
}

const job = defineTable("job", {
  id: t.integer.primaryKey(),
  lockedBy: t.text.nullable().columnName("locked_by"),
})

/** Columns of a table for a statement of SQL text, whose declaration names the columns of kern-db; see the file header. */
export const jobColumns = columnsOf(job, "*", { alias: "j", prefix: "job" })

/** Record of the columns of a table; see the file header. */
export type JobRecord = RecordOf<typeof jobColumns>

/** Columns of a record that is `null` without its row; see the file header. */
export const joinedJobColumns = jobColumns.nullable()

/** Query of SQL text of the columns of a table; see the file header. */
export function findLockedJobs(database: Database) {
  return database.query`SELECT ${jobColumns} FROM job j WHERE j.locked_by IS NOT NULL`.select({
    job: jobColumns,
  })
}
