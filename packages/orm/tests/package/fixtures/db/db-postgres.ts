// Runs a query of SQL text with `kern-db` alone in a transaction in PostgreSQL at DATABASE_URL; prints its decoded record.
import { createDatabase, param } from "kern-db"
import { postgresJsDriver } from "kern-db/postgres-js"
import * as t from "kern-db/types"
import postgres from "postgres"

const database = createDatabase({ driver: postgresJsDriver(postgres(process.env.DATABASE_URL!)) })
try {
  const record = await database.transaction(
    async () =>
      await database.query`SELECT ${1}::integer + 1 AS sum, ${param(t.jsonb, { tags: ["poll"] })} AS settings`
        .select({
          sum: t.integer,
          settings: t.jsonb,
        })
        .take(),
  )
  console.log(JSON.stringify(record))
} finally {
  await database.close()
}
