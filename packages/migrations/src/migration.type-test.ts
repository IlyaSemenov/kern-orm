import { describe, test } from "bun:test"

import type { Database } from "kern-db"
import type { DbOf } from "kern-orm"
import { defineSchema } from "kern-orm"

import type { MigrationDatabase } from "./migration"
import { defineMigration } from "./migration"

const schema = defineSchema({})

declare const database: Database
declare const db: DbOf<typeof schema>

describe("MigrationDatabase", () => {
  test("accepts a Database of kern-db and the database of a Db of kern-orm", () => {
    database satisfies MigrationDatabase
    db.$database satisfies MigrationDatabase
  })
})

describe("defineMigration", () => {
  test("gives the functions of steps the queries, scripts, and statements of the database without its other members", () => {
    defineMigration([
      { up: "CREATE TABLE form (id uuid PRIMARY KEY)", down: "DROP TABLE form" },
      {
        up: async database => {
          await database.script("ALTER TABLE form ADD COLUMN name text")
          await database.query`UPDATE form SET name = ${"Untitled"}`
          await database.execute({ text: "SELECT count(*) FROM form", parameters: [] })
          // @ts-expect-error -- a migration must not close the database
          await database.close()
        },
      },
    ])
  })
})
