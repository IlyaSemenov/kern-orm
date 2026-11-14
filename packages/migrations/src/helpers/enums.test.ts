import { describe, expect, it } from "bun:test"

import { describePostgres } from "../../testing/postgres"

import { createEnum, dropEnum } from "./enums"
import { applyStep } from "./testing"

describe("createEnum", () => {
  it("creates an enum type of a quoted name with quoted values in their order, and drops it", () => {
    expect(createEnum("user_role", ["member", "admin"])).toEqual({
      up: `CREATE TYPE "user_role" AS ENUM ('member', 'admin')`,
      down: 'DROP TYPE "user_role"',
    })
  })

  it("quotes values as literals", () => {
    expect(createEnum("user_role", ["it's", "a\\b"]).up).toBe(
      `CREATE TYPE "user_role" AS ENUM ('it''s', E'a\\\\b')`,
    )
  })

  it("creates an enum type without values", () => {
    expect(createEnum("user_role", []).up).toBe('CREATE TYPE "user_role" AS ENUM ()')
  })
})

describe("dropEnum", () => {
  it("drops an enum type, and creates it again as createEnum does", () => {
    expect(dropEnum("user_role", ["member", "admin"])).toEqual({
      up: 'DROP TYPE "user_role"',
      down: `CREATE TYPE "user_role" AS ENUM ('member', 'admin')`,
    })
  })
})

describePostgres("enum helpers in PostgreSQL", ({ database, testTransaction }) => {
  it("createEnum creates an enum type, and its rollback drops it", async () => {
    const result = await testTransaction(() =>
      applyStep(database, createEnum("user_role", ["member", "it's"])),
    )

    expect(result).toEqual({
      before: [],
      up: ["type user_role ENUM ('member', 'it''s')"],
      down: [],
    })
  })

  it("dropEnum drops an enum type, and its rollback creates it again", async () => {
    const result = await testTransaction(() =>
      applyStep(
        database,
        dropEnum("user_role", ["member", "admin"]),
        "CREATE TYPE user_role AS ENUM ('member', 'admin')",
      ),
    )

    expect(result.up).toEqual([])
    expect(result.down).toEqual(result.before)
  })
})
