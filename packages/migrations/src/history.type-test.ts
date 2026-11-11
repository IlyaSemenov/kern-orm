import { describe, test } from "bun:test"

import { defineMigrations } from "./history"

describe("defineMigrations", () => {
  test("takes loaders of modules and migrations themselves", () => {
    defineMigrations({
      "0001_create_form": async () => ({ default: { up: "CREATE TABLE form (id integer)" } }),
      "0002_create_user": { up: "CREATE TABLE app_user (id integer)" },
      "0003_create_tag": [{ up: "CREATE TABLE tag (id integer)" }],
    })
  })

  test("gives the functions of steps of a migration the database of the migration", () => {
    defineMigrations({
      "0001_fill_form": {
        up: async database => {
          await database.query`UPDATE form SET name = ${"Untitled"}`
          // @ts-expect-error -- a migration must not close the database
          await database.close()
        },
      },
      "0002_fill_user": [
        {
          up: async database => {
            await database.script("UPDATE app_user SET name = 'Untitled'")
          },
        },
      ],
    })
  })

  test("rejects a step with a misspelled down", () => {
    // @ts-expect-error -- a step has up, down, and outsideTransaction
    defineMigrations({ "0001_create_form": { up: "SELECT 1", donw: "SELECT 2" } })
  })
})
