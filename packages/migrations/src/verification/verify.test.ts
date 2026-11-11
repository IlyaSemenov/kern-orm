import { describe, expect, it } from "bun:test"

import type { Database } from "kern-db"
import * as t from "kern-db/types"
import { bindSchema, defineSchema } from "kern-orm"

import { describePostgres } from "../../testing/postgres"
import { MigrationError } from "../error"
import { createExtension } from "../helpers/extensions"
import { defineMigrations } from "../history"
import type { MigrationDatabase } from "../migration"

import type { MigrationTest } from "./migration-test"
import { defineMigrationTest } from "./migration-test"
import { verifyMigrations } from "./verify"

const createForm = {
  up: "CREATE TABLE form (id integer PRIMARY KEY, name text)",
  down: "DROP TABLE form",
}

/** Reads the names of the forms of the schema of a migration, in order. */
const listFormNames = (database: MigrationDatabase) =>
  database.query`SELECT name FROM form ORDER BY id`.pluck(t.text.nullable())

/** Counts the temporary schemas of verifications. */
const countTemporarySchemas = (database: Database) =>
  database.query`SELECT count(*)::integer FROM pg_namespace WHERE nspname LIKE 'kern_verify_%'`.get(
    t.integer,
  )

describePostgres("verifyMigrations", ({ database, testTransaction, recordStatements }) => {
  it("applies, rolls back, and applies again each migration in a temporary schema in a nested transaction that rolls back", async () => {
    const calls: string[] = []
    const record = (call: string) => async (database: MigrationDatabase) => {
      const schemaName = await database.query`SELECT current_schema()::text`.get(t.text)
      calls.push(`${call} in ${schemaName.replace(/^kern_verify_[0-9a-f]{12}$/, "kern_verify_*")}`)
    }
    const history = defineMigrations({
      "0001_create_form": [createForm, { up: record("up 1"), down: record("down 1") }],
      "0002_add_form_slug": [
        { up: "ALTER TABLE form ADD COLUMN slug text", down: "ALTER TABLE form DROP COLUMN slug" },
        { up: record("up 2"), down: record("down 2") },
      ],
    })

    const result = await testTransaction(async () => {
      const searchPath = await database.query`SELECT current_setting('search_path')`.get(t.text)
      await verifyMigrations(database, history)
      return {
        searchPathKept:
          searchPath === (await database.query`SELECT current_setting('search_path')`.get(t.text)),
        schemas: await countTemporarySchemas(database),
      }
    })

    expect(calls).toEqual([
      "up 1 in kern_verify_*",
      "down 1 in kern_verify_*",
      "up 1 in kern_verify_*",
      "up 2 in kern_verify_*",
      "down 2 in kern_verify_*",
      "up 2 in kern_verify_*",
    ])
    expect(result).toEqual({ searchPathKept: true, schemas: 0 })
  })

  it("runs the migrations with the schemas of the history after the temporary schema, and ignores the schema of a Db", async () => {
    let searchPath: string | undefined
    const history = defineMigrations(
      {
        "0001_read_search_path": {
          up: async database => {
            searchPath = await database.query`SELECT current_setting('search_path')`.get(t.text)
          },
        },
      },
      { searchPath: ["extensions"] },
    )
    const db = bindSchema(defineSchema({}), database, { schemaName: "migrations_tenant" })

    await testTransaction(() => verifyMigrations(db, history))

    expect(searchPath).toMatch(/^"kern_verify_[0-9a-f]{12}", "extensions"$/)
  })

  it("verifies a step with outsideTransaction by its up and down", async () => {
    const history = defineMigrations({
      "0001_create_form": createForm,
      "0002_index_form": {
        up: "CREATE INDEX form_name_idx ON form (name)",
        down: "DROP INDEX form_name_idx",
        outsideTransaction: {
          up: "CREATE INDEX CONCURRENTLY form_name_idx ON form (name)",
          down: "DROP INDEX CONCURRENTLY form_name_idx",
        },
      },
    })

    const statements = await testTransaction(() =>
      recordStatements(() => verifyMigrations(database, history)),
    )

    expect(statements).toEqual(
      expect.arrayContaining([
        "CREATE INDEX form_name_idx ON form (name)",
        "DROP INDEX form_name_idx",
      ]),
    )
    expect(statements.filter(text => text.includes("CONCURRENTLY"))).toEqual([])
  })

  it("rejects a rollback that leaves the structure of the schema different from before the migration", async () => {
    const history = defineMigrations({
      "0001_create_form": createForm,
      "0002_require_form_name": [
        { up: "ALTER TABLE form ALTER COLUMN name SET NOT NULL" },
        { up: "CREATE INDEX form_name_idx ON form (name)", down: "SELECT 1" },
      ],
    })

    const error = await testTransaction(() => verifyMigrations(database, history)).catch(
      (error: unknown) => error,
    )

    expect((error as Error).message.split("\n")).toEqual([
      "Rolling back migration 0002_require_form_name does not restore the structure of the schema (- before the migration, + after its rollback):",
      "  - column form.name text",
      "  + column form.name text NOT NULL",
      expect.stringMatching(
        /^ {2}\+ index CREATE INDEX form_name_idx ON kern_verify_\w+\.form USING btree \(name\)$/,
      ),
    ])
  })

  it("compares the owners of objects with the role that runs the verification, whatever role a migration sets", async () => {
    const history = defineMigrations({
      "0001_create_form": createForm,
      "0002_give_form": {
        up: "ALTER TABLE form OWNER TO pg_database_owner; SET LOCAL ROLE pg_database_owner",
      },
    })

    const error = await testTransaction(() => verifyMigrations(database, history)).catch(
      (error: unknown) => error,
    )

    expect((error as Error).message.split("\n")).toEqual([
      "Rolling back migration 0002_give_form does not restore the structure of the schema (- before the migration, + after its rollback):",
      "  - table form",
      "  + table form OWNER pg_database_owner",
    ])
  })

  it("indents the continuation lines of a definition in the lines that differ", async () => {
    const history = defineMigrations({
      "0001_create_function": {
        up: "CREATE FUNCTION form_count() RETURNS bigint LANGUAGE sql AS 'SELECT 1'",
      },
    })

    const error = await testTransaction(() => verifyMigrations(database, history)).catch(
      (error: unknown) => error,
    )

    expect((error as Error).message.split("\n")).toEqual([
      "Rolling back migration 0001_create_function does not restore the structure of the schema (- before the migration, + after its rollback):",
      expect.stringMatching(
        /^ {2}\+ function CREATE OR REPLACE FUNCTION kern_verify_\w+\.form_count\(\)$/,
      ),
      "     RETURNS bigint",
      "     LANGUAGE sql",
      "    AS $function$SELECT 1$function$",
    ])
  })

  it("accepts a rollback that keeps the objects of the extensions that the migration creates", async () => {
    const history = defineMigrations({
      "0001_create_user": [
        createExtension("citext"),
        { up: "CREATE TABLE app_user (email citext)", down: "DROP TABLE app_user" },
      ],
    })

    await testTransaction(() => verifyMigrations(database, history))
  })

  it("rejects a migration that fails to apply again after its rollback, such as one whose change of data has no down", async () => {
    const history = defineMigrations({
      "0001_create_form": createForm,
      "0002_insert_form": { up: "INSERT INTO form (id) VALUES (1)" },
    })

    const error = await testTransaction(() => verifyMigrations(database, history)).catch(
      (error: unknown) => error,
    )

    expect(error).toMatchObject({
      message:
        'Migration 0002_insert_form fails to apply again after its rollback: Migration 0002_insert_form failed in up of step 1: duplicate key value violates unique constraint "form_pkey"',
      cause: { name: "MigrationError", key: "0002_insert_form", step: 1, direction: "up" },
    })
  })

  it.each([
    ["up", { up: "SELECT * FROM missing_form", down: "SELECT 1" }],
    ["down", { up: "SELECT 1", down: "DROP TABLE missing_form" }],
  ] as const)("rejects with the MigrationError of %s that fails", async (direction, step) => {
    const history = defineMigrations({ "0001_create_form": createForm, "0002_fail": step })

    const error = await testTransaction(() => verifyMigrations(database, history)).catch(
      (error: unknown) => error,
    )

    expect(error).toBeInstanceOf(MigrationError)
    expect(error).toMatchObject({ key: "0002_fail", step: 1, direction })
  })

  it("rejects a history without migrations", async () => {
    await expect(
      testTransaction(() => verifyMigrations(database, defineMigrations({}))),
    ).rejects.toThrow("Cannot verify a history without migrations")
  })

  it("rejects a file of migration tests that matches no migration and a migration that fails to load before it executes any statement", async () => {
    const history = defineMigrations({ "0001_create_form": createForm })
    const broken = defineMigrations({ "0001_create_form": async () => ({ default: [] }) })

    const errors = await testTransaction(async () => {
      const tests = {
        "./0002_add_form_slug.migration-test.ts": { default: { name: "x", setup() {} } },
      }
      return {
        statements: await recordStatements(async () => {
          await verifyMigrations(database, history, { tests }).catch(() => {})
          await verifyMigrations(database, broken).catch(() => {})
        }),
        unknownTest: await verifyMigrations(database, history, { tests }).catch(
          (error: unknown) => (error as Error).message,
        ),
        brokenMigration: await verifyMigrations(database, broken).catch(
          (error: unknown) => (error as Error).message,
        ),
      }
    })

    expect(errors).toEqual({
      statements: [],
      unknownTest:
        "File of migration tests ./0002_add_form_slug.migration-test.ts matches no migration of the history: name it <key>.migration-test.ts or <key>.<name>.migration-test.ts after the key of its migration",
      brokenMigration:
        "Migration 0001_create_form must export a step or a non-empty array of steps as its default export",
    })
  })

  describe("migration tests", () => {
    const addFormSlug = {
      up: "ALTER TABLE form ADD COLUMN slug text; UPDATE form SET slug = lower(name)",
      down: "ALTER TABLE form DROP COLUMN slug",
    }

    const history = defineMigrations({
      "0001_create_form": createForm,
      "0002_add_form_slug": addFormSlug,
      "0003_create_tag": { up: "CREATE TABLE tag (id integer)", down: "DROP TABLE tag" },
    })

    /** Verifies `history` with migration tests in files by path, given as modules. */
    const verifyWithTests = (tests: Record<string, MigrationTest | MigrationTest[]>) => {
      const modules: Record<string, unknown> = {}
      for (const [path, exported] of Object.entries(tests)) {
        modules[path] = { default: exported }
      }
      return testTransaction(() => verifyMigrations(database, history, { tests: modules }))
    }

    it("runs each migration test from the schema before its migration, in a nested transaction of its own", async () => {
      const calls: string[] = []
      const recordForms = (call: string) => async (database: MigrationDatabase) => {
        calls.push(`${call}: ${JSON.stringify(await listFormNames(database))}`)
      }

      await verifyWithTests({
        "./0002_add_form_slug.migration-test.ts": [
          defineMigrationTest("fills slugs from names", {
            setup: async database => {
              await recordForms("setup 1")(database)
              await database.query`INSERT INTO form (id, name) VALUES (1, 'Survey')`
            },
            assertUp: async database => {
              calls.push(
                `assertUp 1: ${JSON.stringify(await database.query`SELECT slug FROM form`.pluck(t.text))}`,
              )
            },
            assertDown: recordForms("assertDown 1"),
          }),
          defineMigrationTest("applies to forms without names", {
            setup: async database => {
              await recordForms("setup 2")(database)
              await database.query`INSERT INTO form (id) VALUES (2)`
            },
          }),
        ],
        "./0001_create_form.migration-test.ts": defineMigrationTest("creates no forms", {
          assertUp: recordForms("assertUp 0"),
        }),
        "./0003_create_tag.migration-test.ts": defineMigrationTest("keeps forms", {
          setup: recordForms("setup 3"),
        }),
      })

      expect(calls).toEqual([
        "assertUp 0: []",
        "setup 1: []",
        'assertUp 1: ["survey"]',
        'assertDown 1: ["Survey"]',
        "setup 2: []",
        "setup 3: []",
      ])
    })

    it("gives assertUpError the MigrationError of up, after which the database of the test still runs queries", async () => {
      const uniqueNames = defineMigrations({
        "0001_create_form": createForm,
        "0002_add_unique_name": {
          up: "CREATE UNIQUE INDEX form_lower_name_idx ON form (lower(name))",
          down: "DROP INDEX form_lower_name_idx",
        },
      })
      let result: unknown

      await testTransaction(() =>
        verifyMigrations(database, uniqueNames, {
          tests: {
            "./0002_add_unique_name.migration-test.ts": {
              default: defineMigrationTest("rejects names that differ only by case", {
                setup: database =>
                  database.script(
                    "INSERT INTO form (id, name) VALUES (1, 'Survey'), (2, 'SURVEY')",
                  ),
                assertUpError: async (error, database) => {
                  result = {
                    error: error instanceof MigrationError && {
                      key: error.key,
                      step: error.step,
                      direction: error.direction,
                      code: (error.cause as { code?: string }).code,
                    },
                    forms: await listFormNames(database),
                  }
                },
              }),
            },
          },
        }),
      )

      expect(result).toEqual({
        error: { key: "0002_add_unique_name", step: 1, direction: "up", code: "23505" },
        forms: ["Survey", "SURVEY"],
      })
    })

    it("rejects a migration test whose up applies although the test expects it to fail", async () => {
      await expect(
        verifyWithTests({
          "./0002_add_form_slug.migration-test.ts": defineMigrationTest("rejects forms", {
            assertUpError: () => {},
          }),
        }),
      ).rejects.toThrow(
        'Migration test "rejects forms" in ./0002_add_form_slug.migration-test.ts expects up to fail, but it applied',
      )
    })

    it.each([
      ["setup", { setup: () => Promise.reject(new Error("broken")) }],
      ["assertUp", { assertUp: () => Promise.reject(new Error("broken")) }],
      ["assertDown", { assertDown: () => Promise.reject(new Error("broken")) }],
    ])(
      "rejects a failure of %s with an error that names the test, its file, and the stage, keeping the error in cause",
      async (stage, callbacks) => {
        const error = await verifyWithTests({
          "./0002_add_form_slug.migration-test.ts": defineMigrationTest("fills slugs", callbacks),
        }).catch((error: unknown) => error)

        expect(error).toMatchObject({
          message: `Migration test "fills slugs" in ./0002_add_form_slug.migration-test.ts failed in ${stage}: broken`,
          cause: { message: "broken" },
        })
      },
    )

    it("rejects up of a migration test that fails without assertUpError, naming the step of the migration", async () => {
      const error = await verifyWithTests({
        "./0002_add_form_slug.migration-test.ts": defineMigrationTest("fills slugs", {
          setup: database => database.script("ALTER TABLE form ADD COLUMN slug text"),
        }),
      }).catch((error: unknown) => error)

      expect(error).toMatchObject({
        message:
          'Migration test "fills slugs" in ./0002_add_form_slug.migration-test.ts failed in up: Migration 0002_add_form_slug failed in up of step 1: column "slug" of relation "form" already exists',
        cause: { name: "MigrationError", key: "0002_add_form_slug", direction: "up" },
      })
    })
  })
})
