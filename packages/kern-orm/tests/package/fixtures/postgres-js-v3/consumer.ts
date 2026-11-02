// Uses the entry point of `@kern-orm/postgres-js-v3` with postgres.js 3 without connecting to a database.
import type { PostgresJsDriverOptions } from "@kern-orm/postgres-js-v3"
import { postgresJsDriver } from "@kern-orm/postgres-js-v3"
import { createDatabase } from "kern-orm"
import postgres from "postgres"

export const options: PostgresJsDriverOptions = { closeTimeout: 1 }
export const driver = postgresJsDriver(postgres(), options)

// Closing ends the client of postgres.js 3, which never opened a connection.
await createDatabase({ driver }).close()
const error = await driver.acquire().catch((error: unknown) => error)
console.log(JSON.stringify({ acquireAfterClose: (error as Error).message }))
