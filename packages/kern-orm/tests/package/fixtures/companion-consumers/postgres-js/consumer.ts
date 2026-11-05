// Runs `@kern-orm/postgres-js` with a version of `kern-orm` in its range, in PostgreSQL at DATABASE_URL.
import { postgresJsDriver } from "@kern-orm/postgres-js"
import { createDatabase, createStatement } from "kern-orm"
import postgres from "postgres"

const database = createDatabase({
  driver: postgresJsDriver(postgres(process.env.DATABASE_URL!)),
})
const pooled = await database.execute(createStatement("SELECT 1"))
const reserved = await database.transaction(() => database.execute(createStatement("SELECT 2")))
await database.close()
console.log(JSON.stringify({ pooled: pooled.rows, reserved: reserved.rows }))
