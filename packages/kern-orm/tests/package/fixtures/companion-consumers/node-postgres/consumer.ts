// Runs `@kern-orm/node-postgres` with a version of `kern-orm` in its range, in PostgreSQL at DATABASE_URL.
import { nodePostgresDriver } from "@kern-orm/node-postgres"
import { createDatabase, createStatement } from "kern-orm"
import { Pool } from "pg"

// One connection makes a statement on the pool run on the connection of the last transaction, unless the driver closed it.
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 })
// The first ROLLBACK fails without reaching PostgreSQL, which leaves its transaction open on the connection.
let rollbackFailed = false
pool.on("connect", client => {
  const query = client.query.bind(client) as (config: unknown) => Promise<unknown>
  Object.assign(client, {
    query(config: unknown) {
      if (!rollbackFailed && (config as { text?: unknown }).text === "ROLLBACK") {
        rollbackFailed = true
        return Promise.reject(new Error("ROLLBACK failed"))
      }
      return query(config)
    },
  })
})

const database = createDatabase({ driver: nodePostgresDriver(pool) })
const pooled = await database.execute(createStatement("SELECT 1"))
const reserved = await database.transaction(() => database.execute(createStatement("SELECT 2")))
// The driver must not return the connection of the failed transaction to the pool, where the next statement would fail in it.
await database
  .transaction(() => database.execute(createStatement("SELECT 1/0")))
  .catch(() => undefined)
const afterFailedRollback = await database.execute(createStatement("SELECT 3"))
await database.close()
console.log(
  JSON.stringify({
    pooled: pooled.rows,
    reserved: reserved.rows,
    afterFailedRollback: afterFailedRollback.rows,
  }),
)
