// Script of the command line of `@kern-orm/migrations`, as a project writes it, without connecting to a database: its history comes from the list module that `new` writes, which starts as the empty list of `cli-migrations/index.ts`; it prints the keys of the history and the errors of loading them.
import { join } from "node:path"

import { defineMigrations } from "@kern-orm/migrations"
import { runMigrationCli } from "@kern-orm/migrations/cli"
import { createDatabase } from "kern-orm"

import list from "./cli-migrations/index.ts"

const rejectStatement = async (): Promise<never> => {
  throw new Error("The fixture does not query the database")
}
const database = createDatabase({
  driver: {
    closesReservedConnections: true,
    execute: rejectStatement,
    executeScript: rejectStatement,
    acquire: rejectStatement,
    close: async () => {},
  },
})

const migrations = defineMigrations(list)
const loadErrors: string[] = []
for (const key of migrations.keys) {
  await migrations.load(key).catch((error: unknown) => loadErrors.push((error as Error).message))
}

const directory = join(import.meta.dirname, "cli-migrations")
await runMigrationCli(database, migrations, {
  directory,
  listModule: join(directory, "index.ts"),
})
await database.close()
console.log(JSON.stringify({ keys: migrations.keys, loadErrors }))
