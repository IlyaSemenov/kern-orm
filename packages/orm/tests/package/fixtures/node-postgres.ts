// Uses the entry point of `@kern-orm/node-postgres` with its peer dependencies without connecting to a database; the driver resolves a copy of `kern-orm` of its own.
import { nodePostgresDriver } from "@kern-orm/node-postgres"
import { ConnectionError, createDatabase, QueryError } from "kern-orm"
import { Pool } from "pg"

export const driver = nodePostgresDriver(new Pool())

// Closing ends the pool, which never opened a connection.
await createDatabase({ driver }).close()
const error = await driver.acquire().catch((error: unknown) => error)
console.log(
  JSON.stringify({
    acquireAfterClose: (error as Error).message,
    isConnectionError: error instanceof ConnectionError,
    // `instanceof` narrows the type of the error to the class.
    queryErrorCode: error instanceof QueryError ? error.code : null,
  }),
)
