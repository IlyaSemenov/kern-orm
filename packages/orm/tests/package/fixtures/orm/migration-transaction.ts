// Migrates the `Db` of a schema, bound to the database that the module creates, and queries the table of the migration with the ORM, all in one transaction in PostgreSQL at DATABASE_URL.
// Rolls the transaction back and prints the applied migrations, the queried names, and whether the schema of the `Db` remains.
import { defineMigrations, migrate } from "kern-migrations"
import { bindSchema, createDatabase, defineSchema, defineTable } from "kern-orm"
import { postgresJsDriver } from "kern-orm/db/postgres-js"
import * as t from "kern-orm/types"
import postgres from "postgres"

const form = defineTable("form", {
  id: t.integer.primaryKey(),
  name: t.text,
})

const migrations = defineMigrations({
  "0001_create_form": {
    up: "CREATE TABLE form (id integer PRIMARY KEY, name text NOT NULL)",
    down: "DROP TABLE form",
  },
})

const schemaName = "kern_package_migration"
const database = createDatabase({ driver: postgresJsDriver(postgres(process.env.DATABASE_URL!)) })
const db = bindSchema(defineSchema({ form }), database, { schemaName })

// Error that rolls the transaction back, which the catch tells from an unexpected failure.
const rollback = new Error("Roll back the migration")
try {
  let migrated: { applied: string[]; names: string[] } | undefined
  await db
    .$transaction(async () => {
      const applied = await migrate(db, migrations)
      await db.form.insert({ id: 1, name: "Survey" })
      migrated = { applied, names: await db.form.pluck("name") }
      throw rollback
    })
    .catch((error: unknown) => {
      if (error !== rollback) {
        throw error
      }
    })
  const schemaExists =
    await database.query`SELECT EXISTS (SELECT FROM pg_catalog.pg_namespace WHERE nspname = ${schemaName})`.get(
      t.boolean,
    )
  console.log(JSON.stringify({ ...migrated, schemaExists }))
} finally {
  await database.close()
}
