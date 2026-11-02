import type { MigrationStep } from "../migration"
import { quoteDollar, quoteIdentifier, quoteLiteral } from "../sql"

/** Options of `createExtension`. */
export interface ExtensionOptions {
  /** PostgreSQL schema of the objects of the extension, such as `"extensions"`, which the step creates when it is missing; without it, the first schema of the search path, which is the target schema of the migration. */
  schema?: string
}

/**
 * Builds a step that creates a PostgreSQL extension unless it exists, with its schema when the schema is missing, and does nothing on rollback, since an extension and its schema belong to the whole database, such as to every tenant.
 *
 * It sends no notice for an existing extension, unlike `CREATE EXTENSION IF NOT EXISTS`, which postgres.js would log at every target.
 * Migrations of different targets that create a missing extension at once wait for each other instead of failing on the duplicate.
 */
export function createExtension(name: string, options: ExtensionOptions = {}): MigrationStep {
  const exists = `EXISTS (SELECT FROM pg_catalog.pg_extension WHERE extname = ${quoteLiteral(name)})`
  const schema =
    options.schema === undefined ? "" : ` WITH SCHEMA ${quoteIdentifier(options.schema)}`
  // Checking pg_namespace first keeps `IF NOT EXISTS` from sending a notice of an existing schema; `IF NOT EXISTS` keeps a schema that something other than a migration created meanwhile from failing the step.
  const createSchema =
    options.schema === undefined
      ? ""
      : `
      IF NOT EXISTS (SELECT FROM pg_catalog.pg_namespace WHERE nspname = ${quoteLiteral(options.schema)}) THEN
        CREATE SCHEMA IF NOT EXISTS ${quoteIdentifier(options.schema)};
      END IF;`
  // The lock lasts until the migration commits, and the second check sees an extension that another migration committed meanwhile.
  // One lock for all extensions keeps histories that create several extensions in different orders from deadlocking.
  const body = `
BEGIN
  IF NOT ${exists} THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('@kern-orm/migrations createExtension', 0));
    IF NOT ${exists} THEN${createSchema}
      CREATE EXTENSION ${quoteIdentifier(name)}${schema};
    END IF;
  END IF;
END
`
  return { up: `DO ${quoteDollar(body)}` }
}
