// Runs `@kern-orm/node-postgres` with a version of `kern-orm` in its range, in PostgreSQL at DATABASE_URL.
import { nodePostgresDriver } from "@kern-orm/node-postgres"
import { createDatabase, createStatement } from "kern-orm"
import { Pool } from "pg"

const database = createDatabase({
  driver: nodePostgresDriver(new Pool({ connectionString: process.env.DATABASE_URL })),
})
const pooled = await database.execute(createStatement("SELECT 1"))
const reserved = await database.transaction(() => database.execute(createStatement("SELECT 2")))
await database.close()
console.log(JSON.stringify({ pooled: pooled.rows, reserved: reserved.rows }))
