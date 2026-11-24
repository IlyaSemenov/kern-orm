// Runs a statement through the packed Bun SQL driver and exports the driver to check its inferred declaration.
import { bunSqlDriver } from "kern-orm/db/bun-sql"

export const driver = bunSqlDriver(new Bun.SQL(process.env.DATABASE_URL!, { prepare: false }))
try {
  console.log(
    JSON.stringify((await driver.execute({ text: "SELECT $1::integer", parameters: ["42"] })).rows),
  )
} finally {
  await driver.close()
}
