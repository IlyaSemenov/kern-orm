// Uses the entry point of `@kern-orm/node-postgres` with its peer dependencies without connecting to a database.
import { nodePostgresDriver } from "@kern-orm/node-postgres"
import { createDatabase } from "kern-orm"
import { Pool } from "pg"

export const driver = nodePostgresDriver(new Pool())

// Closing ends the pool, which never opened a connection.
await createDatabase({ driver }).close()
const error = await driver.acquire().catch((error: unknown) => error)
console.log(JSON.stringify({ acquireAfterClose: (error as Error).message }))
