// Exports custom types, queries of SQL text, the columns of a table, and a schema of a sequence from a module that imports only the root of `kern-orm` and `kern-orm/types`, as a module of presets does.
// The package test emits its declarations in a program of its own of a consumer that cannot resolve kern-db, where they name the types of kern-db through the root of `kern-orm`.
import type { AnyDb, Database, RecordOf } from "kern-orm"
import {
  columnsOf,
  defineSchema,
  defineSequence,
  defineTable,
  defineType,
  orderingOperators,
  textOperators,
} from "kern-orm"
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

/** Template of the queries of SQL text of `database`, whose declaration names the template of kern-db; see the file header. */
export function getQueryTemplate(database: Database) {
  return database.query
}

/** Starter of the templates of `$queryOn` of a `Db`, whose declaration names the executor of kern-db; see the file header. */
export function getQueryOn(db: AnyDb) {
  return db.$queryOn
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

/** Schema of a table and a sequence, whose declaration names the sequences of kern-orm; see the file header. */
export const jobSchema = defineSchema({ job, claimSeq: defineSequence("claim_seq") })

/** Next value of the sequence of the schema, whose declaration names the expression of a sequence; see the file header. */
export const nextClaim = jobSchema.claimSeq.nextval()
