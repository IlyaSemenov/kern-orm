// Uses the entry point of `kern-migrations` without connecting to a database.
import type { MigrationTarget } from "kern-migrations"
import { defineMigration, defineMigrations, migrate, MigrationError } from "kern-migrations"

export const migration = defineMigration({
  up: "CREATE TABLE form (id integer)",
  down: "DROP TABLE form",
})

export const migrations = defineMigrations(
  {
    "./migrations/0002_drop_form.ts": async () => ({ up: "DROP TABLE form" }),
    "0001_create_form": migration,
  },
  { searchPath: ["extensions"] },
)

export const migrateTarget = (target: MigrationTarget) => migrate(target, migrations)

const steps = await migrations.load("0001_create_form")
const error = await migrations.load("0002_drop_form").catch((error: unknown) => error)
if (!(error instanceof MigrationError)) {
  throw new Error("Expected a MigrationError")
}
console.log(
  JSON.stringify({
    keys: migrations.keys,
    steps,
    loadError: { name: error.name, key: error.key, message: error.message },
  }),
)
