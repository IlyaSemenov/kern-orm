// Uses `kern-orm/db/node-postgres` with its peer dependencies without connecting to a database; the errors of the driver are those of `kern-orm`.
import { ConnectionError, createDatabase, QueryError } from "kern-orm"
import { nodePostgresDriver } from "kern-orm/db/node-postgres"
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
