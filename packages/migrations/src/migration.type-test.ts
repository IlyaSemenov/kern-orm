import { describe, test } from "bun:test"

import { defineMigration } from "./migration"

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
