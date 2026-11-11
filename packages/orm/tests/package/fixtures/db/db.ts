// Uses the entry points of `kern-db` other than `kern-db/node-postgres`, without `kern-orm` and `pg`: queries of SQL text in a transaction on the recording driver of the fixtures, and the driver of postgres.js and the test helpers, which it creates without connecting; prints the result and the recorded statements.
import type { SqlFragment } from "kern-db"
import { createDatabase, identifier, param, sql } from "kern-db"
import { postgresJsDriver } from "kern-db/postgres-js"
import type { TestFixture } from "kern-db/testing"
import { createTestHelpers } from "kern-db/testing"
import * as t from "kern-db/types"
import postgres from "postgres"

import { createRecordingDriver } from "./recording-driver.ts"

const { driver, statements } = createRecordingDriver(text =>
  text.startsWith("SELECT")
    ? { columns: ["id", "tags"], rows: [["1", "{draft,poll}"]] }
    : { columns: [], rows: [] },
)

/** Database of the module, whose declaration names the database of kern-db. */
export const database = createDatabase({ driver })

/** Returns the condition of the forms of `name`, a fragment of kern-db. */
export function isNamed(name: string): SqlFragment {
  return sql`${identifier("form", "name")} = ${name}`
}

/** Starts the query of the forms of `name` with `tag`, whose inferred declaration names the query of SQL text of kern-db. */
export function selectForms(name: string, tag: string) {
  return database.query`SELECT id, tags FROM form WHERE ${isNamed(name)} AND tags @> ${param(t.array(t.text), [tag])}`.select(
    {
      id: t.integer,
      tags: t.array(t.text),
    },
  )
}

const forms = await database.transaction(async () => await selectForms("Survey", "poll"))

// The driver and the test helpers, whose hooks never run.
const postgresDriver = postgresJsDriver(postgres())
const { useTestFixture } = createTestHelpers(createDatabase({ driver, test: true }), {
  before: () => {},
  after: () => {},
})
useTestFixture(async () => ({ formId: 1 })) satisfies TestFixture<{ formId: number }>
await postgresDriver.close()
await database.close()

console.log(JSON.stringify({ forms, statements }))
