import { describe, test } from "bun:test"

import type { Database } from "kern-db"

import { defineMigrations } from "./history"
import { rollback } from "./migrate"

declare const database: Database
const history = defineMigrations({})

describe("rollback", () => {
  test("rejects a count that is neither a number nor all", async () => {
    // @ts-expect-error -- a count is a number or "all"
    await rollback(database, history, { count: "last" })
  })
})
