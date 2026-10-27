// Instantiations that the first use of a Db adds to a consumer that only defines its schemas and Dbs.
// The count in `.types([...])` is the one that `bun run --cwd benchmarks bench:types -u` wrote; a run prints the change from it.

import { bench } from "@ark/attest"
import type { DbOf } from "kern-orm"

import { catalogSchema, formsDb, formsSchema, storeDb, tenantDb } from "./fixture.ts"

bench("DbOf assignment of 2 tables", () => {
  const sharedDb: DbOf<typeof formsSchema> = tenantDb
  return sharedDb
}).types([1768, "instantiations"])

bench("DbOf assignment of 12 tables", () => {
  const sharedDb: DbOf<typeof catalogSchema> = storeDb
  return sharedDb
}).types([2573, "instantiations"])

bench("first unbound query", async () => {
  await formsDb.$execute(
    formsSchema.form
      .where({ id: "x" })
      .select("id", "name")
      .select(form => ({
        title: form.name,
      }))
      .take(),
  )
}).types([2450, "instantiations"])
