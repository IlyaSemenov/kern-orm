// Runs `@kern-orm/migrations` with a version of `kern-orm` in its range, in PostgreSQL at DATABASE_URL, through the members of `Database` and `Db` that it uses, and rolls back what it creates.
import {
  defineMigration,
  defineMigrations,
  getMigrationStatus,
  migrate,
  rollback,
} from "@kern-orm/migrations"
import { verifyMigrations } from "@kern-orm/migrations/testing"
import { postgresJsDriver } from "@kern-orm/postgres-js"
import { createDatabase, defineSchema } from "kern-orm"
import postgres from "postgres"

const migrations = defineMigrations({
  "0001_create_form": async () => ({
    default: defineMigration({ up: "CREATE TABLE form (id integer)", down: "DROP TABLE form" }),
  }),
  "0002_add_form": async () => ({
    default: defineMigration({
      up: async database => await database.query`INSERT INTO form (id) VALUES (1)`,
      down: "DELETE FROM form",
    }),
  }),
})

const database = createDatabase({ driver: postgresJsDriver(postgres(process.env.DATABASE_URL!)) })
const db = database.bind(defineSchema({}), { schemaName: "kern_compatibility" })
const rollbackSignal = new Error("Roll back the target")
try {
  await verifyMigrations(db, migrations)
  await database.transaction(async () => {
    const applied = await migrate(db, migrations)
    const rolledBack = await rollback(db, migrations)
    const status = await getMigrationStatus(db, migrations)
    console.log(JSON.stringify({ applied, rolledBack, status }))
    throw rollbackSignal
  })
} catch (error) {
  if (error !== rollbackSignal) {
    throw error
  }
} finally {
  await database.close()
}
