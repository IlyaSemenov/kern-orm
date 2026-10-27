// Instantiations that the first use of a Db adds to a consumer that only defines its schemas and Dbs.
// The count in `.types([...])` is the one that `bun run --cwd benchmarks bench:types -u` wrote; a run prints the change from it.

import { bench } from "@ark/attest"
import type { DbOf } from "kern-orm"

import { formsDb, formsSchema, tenantDb } from "./fixture.ts"

bench("DbOf assignment", () => {
  const sharedDb: DbOf<typeof formsSchema> = tenantDb
  return sharedDb
}).types([65929, "instantiations"])

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
}).types([4670, "instantiations"])
