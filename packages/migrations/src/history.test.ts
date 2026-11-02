import { describe, expect, it } from "bun:test"

import { MigrationError } from "./error"
import { defineMigrations } from "./history"

const load = async () => ({ default: { up: "SELECT 1" } })

describe("defineMigrations", () => {
  it("orders migrations by their numbers and takes the keys of paths from their file names", () => {
    const history = defineMigrations({
      "./migrations/10_add_email.ts": load,
      "./migrations/0002_create_user.ts": load,
      "0001_create_form": load,
    })

    expect(history.keys).toEqual(["0001_create_form", "0002_create_user", "10_add_email"])
  })

  it("defaults the table of versions and lists no schemas after the target schema", () => {
    expect(defineMigrations({})).toMatchObject({ tableName: "kern_migration", searchPath: [] })
    expect(
      defineMigrations({}, { tableName: "migration", searchPath: ["extensions"] }),
    ).toMatchObject({ tableName: "migration", searchPath: ["extensions"] })
  })

  it.each([
    "create_form",
    "0001",
    "0001_",
    "./migrations/0001_create_form.sql.ts",
    "0001_create form",
  ])("rejects key %s", name => {
    expect(() => defineMigrations({ [name]: load })).toThrow(
      `Migration ${name} must be named <number>_<name>, such as 0001_create_form, without dots`,
    )
  })

  it("rejects two keys of one number, such as of two branches", () => {
    expect(() =>
      defineMigrations({
        "0002_create_user": load,
        "./migrations/2_create_tag.ts": load,
        "0001_create_form": load,
      }),
    ).toThrow(
      "Migrations 0002_create_user and 2_create_tag have the same number: give each migration its own number",
    )
  })
})

describe("load", () => {
  it("loads the module of a migration only when called and returns its steps", async () => {
    const loaded: string[] = []
    const history = defineMigrations({
      "0001_create_form": async () => {
        loaded.push("0001_create_form")
        return { default: { up: "CREATE TABLE form (id integer)" } }
      },
      "0002_create_user": async () => {
        loaded.push("0002_create_user")
        return { default: [{ up: "CREATE TABLE app_user (id integer)" }] }
      },
    })

    expect(loaded).toEqual([])
    expect(await history.load("0002_create_user")).toEqual([
      { up: "CREATE TABLE app_user (id integer)" },
    ])
    expect(loaded).toEqual(["0002_create_user"])
  })

  // rake-db shared the changes of migrations of two histories under one key: https://github.com/romeerez/orchid-orm/issues/764
  it("loads the migration of its own history for a key of another history", async () => {
    const tenantHistory = defineMigrations({
      "0001_init": async () => ({ default: { up: "CREATE TABLE form (id integer)" } }),
    })
    const saasHistory = defineMigrations({
      "0001_init": async () => ({ default: { up: "CREATE TABLE tenant (id integer)" } }),
    })

    expect(await tenantHistory.load("0001_init")).toEqual([
      { up: "CREATE TABLE form (id integer)" },
    ])
    expect(await saasHistory.load("0001_init")).toEqual([
      { up: "CREATE TABLE tenant (id integer)" },
    ])
  })

  it("rejects a module that fails to load with a MigrationError of its key", async () => {
    const failure = new Error("Cannot find module")
    const history = defineMigrations({
      "0001_create_form": () => Promise.reject(failure),
    })

    const error = await history.load("0001_create_form").catch((error: unknown) => error)

    expect(error).toBeInstanceOf(MigrationError)
    expect(error).toMatchObject({
      message: "Cannot load migration 0001_create_form: Cannot find module",
      key: "0001_create_form",
      step: undefined,
      cause: failure,
    })
  })

  it("rejects a module without a migration as its default export", async () => {
    const history = defineMigrations({
      "0001_create_form": async () => ({ up: "CREATE TABLE form (id integer)" }),
    })

    await expect(history.load("0001_create_form")).rejects.toThrow(
      "Migration 0001_create_form must export a step or a non-empty array of steps as its default export",
    )
  })

  it("rejects a key that the history lacks", async () => {
    await expect(defineMigrations({}).load("0001_create_form")).rejects.toThrow(
      "The history has no migration 0001_create_form",
    )
  })
})
