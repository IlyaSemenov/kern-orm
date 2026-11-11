// Runs a query of the ORM and a query of SQL text of the database that the `Db` is bound to in one ambient transaction, without PostgreSQL; prints the recorded statements.
import { bindSchema, createDatabase, defineSchema, defineTable } from "kern-orm"
import * as t from "kern-orm/types"

import { createRecordingDriver } from "./recording-driver.ts"

const form = defineTable("form", {
  id: t.uuid.primaryKey(),
  name: t.text,
})

const { driver, statements } = createRecordingDriver(text =>
  text.startsWith("SELECT") ? { columns: ["name"], rows: [["Survey"]] } : { columns: [], rows: [] },
)
const database = createDatabase({ driver })
const db = bindSchema(defineSchema({ form }), database)

const result = await db.$transaction(async () => {
  const names = await db.form.pluck("name")
  const count = await database.query`UPDATE form SET name = ${"Poll"}`
  return { names, count }
})
await database.close()
console.log(JSON.stringify({ result, statements }))
