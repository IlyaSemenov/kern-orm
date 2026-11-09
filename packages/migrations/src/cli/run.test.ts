import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { mkdtemp, readdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, relative } from "node:path"
import { pathToFileURL } from "node:url"

import { createDatabase, defineSchema, defineTable } from "kern-orm"
import * as t from "kern-orm/types"

import { describePostgres } from "../../testing/postgres"
import { MigrationError } from "../error"
import type { MigrationLoader } from "../history"
import { defineMigrations } from "../history"
import type { MigrationTarget } from "../target"

import { usage } from "./args"
import type { MigrationCliOptions } from "./run"
import { runCli } from "./run"

const form = defineTable("form", {
  id: t.integer.primaryKey(),
})

const schema = defineSchema({ form })

const history = defineMigrations({
  "0001_create_form": loadMigration({
    up: "CREATE TABLE form (id integer PRIMARY KEY)",
    down: "DROP TABLE form",
  }),
  "0002_create_user": loadMigration({
    up: "CREATE TABLE app_user (id integer PRIMARY KEY)",
    down: "DROP TABLE app_user",
  }),
})

/** Output of a run of the command line, with its exit code. */
interface CliRun {
  readonly exitCode: number
  readonly log: string[]
  readonly errors: unknown[]
}

/** Runs the command line of `args` on `target` with `history` and records its output. */
async function run(
  target: MigrationTarget,
  args: string[],
  options: Omit<MigrationCliOptions, "args"> = {},
): Promise<CliRun> {
  const log: string[] = []
  const errors: unknown[] = []
  const exitCode = await runCli(
    target,
    history,
    { ...options, args },
    {
      log: text => log.push(text),
      error: value => errors.push(value),
    },
  )
  return { exitCode, log, errors }
}

describePostgres("runCli", ({ database, testTransaction, recordStatements }) => {
  const db = database.bind(schema, { schemaName: "migrations_cli" })

  it("migrates, rolls back, and redoes migrations, and prints their keys", async () => {
    const runs = await testTransaction(async () => [
      await run(db, ["migrate", "1"]),
      await run(db, ["migrate"]),
      await run(db, ["migrate"]),
      await run(db, ["redo", "2"]),
      await run(db, ["rollback", "all"]),
      await run(db, ["rollback"]),
    ])

    expect(runs.map(({ exitCode, log }) => ({ exitCode, log }))).toEqual([
      { exitCode: 0, log: ["Applied 0001_create_form"] },
      { exitCode: 0, log: ["Applied 0002_create_user"] },
      { exitCode: 0, log: ["No pending migrations"] },
      {
        exitCode: 0,
        log: [
          "Rolled back 0002_create_user",
          "Rolled back 0001_create_form",
          "Applied 0001_create_form",
          "Applied 0002_create_user",
        ],
      },
      { exitCode: 0, log: ["Rolled back 0002_create_user", "Rolled back 0001_create_form"] },
      { exitCode: 0, log: ["No applied migrations"] },
    ])
  })

  it("prints the status of the applied, pending, and unknown migrations of the schema", async () => {
    const result = await testTransaction(async () => {
      await run(db, ["migrate", "1"])
      await database.script(
        "INSERT INTO migrations_cli.kern_migration (key) VALUES ('0003_create_tag')",
      )
      return await run(db, ["status"])
    })

    expect(result).toEqual({
      exitCode: 0,
      log: [
        'Migrations of schema "migrations_cli":',
        "  applied  0001_create_form",
        "  pending  0002_create_user",
        "  unknown  0003_create_tag",
      ],
      errors: [],
    })
  })

  it("targets the schema of --schema instead of that of the Db", async () => {
    const result = await testTransaction(async () => {
      await run(db, ["migrate", "--schema", "migrations_cli_2"])
      return await run(db, ["status", "-s", "migrations_cli_2"])
    })

    expect(result.log).toEqual([
      'Migrations of schema "migrations_cli_2":',
      "  applied  0001_create_form",
      "  applied  0002_create_user",
    ])
  })

  it("names --schema when the function of the schema of a Db throws, such as without a current tenant", async () => {
    const failure = new Error("No tenant in the context")
    const tenantDb = database.bind(schema, {
      schemaName: () => {
        throw failure
      },
    })

    const result = await testTransaction(async () => ({
      withoutSchema: await run(tenantDb, ["migrate"]),
      withSchema: await run(tenantDb, ["migrate", "--schema", "migrations_cli"]),
    }))

    expect(result.withoutSchema.exitCode).toBe(1)
    expect(result.withoutSchema.errors).toEqual([expect.any(Error)])
    expect(result.withoutSchema.errors[0]).toMatchObject({
      message:
        "Cannot resolve the PostgreSQL schema of the target: No tenant in the context; pass --schema",
      cause: failure,
    })
    expect(result.withSchema.log).toEqual(["Applied 0001_create_form", "Applied 0002_create_user"])
  })

  it("reads the schema of a Db once, and not with --schema", async () => {
    let reads = 0
    const target = {
      $database: database,
      get $schemaName() {
        reads++
        return undefined
      },
    }

    const result = await testTransaction(async () => {
      await database.script("CREATE SCHEMA migrations_cli_current")
      const withoutSchema = await database.transaction(() => run(target, ["status"]), {
        searchPath: ["migrations_cli_current"],
      })
      const readsWithoutSchema = reads
      await run(target, ["status", "--schema", "migrations_cli"])
      return { log: withoutSchema.log, readsWithoutSchema, reads }
    })

    expect(result).toEqual({
      log: [
        'Migrations of schema "migrations_cli_current":',
        "  pending  0001_create_form",
        "  pending  0002_create_user",
      ],
      readsWithoutSchema: 1,
      reads: 1,
    })
  })

  it("prints the error of a command and exits with 1", async () => {
    const result = await testTransaction(async () => {
      await database.script(
        "CREATE SCHEMA migrations_cli; CREATE TABLE migrations_cli.form (id integer)",
      )
      return await run(db, ["migrate"])
    })

    expect(result.exitCode).toBe(1)
    expect(result.log).toEqual([])
    expect(result.errors).toEqual([expect.any(MigrationError)])
    expect((result.errors[0] as Error).message).toBe(
      'Migration 0001_create_form failed in up of step 1: relation "form" already exists',
    )
  })

  it("prints a usage error with a hint and exits with 1 before any statement", async () => {
    let result: CliRun | undefined
    const statements = await recordStatements(async () => {
      result = await run(db, ["rollback", "0"])
    })

    expect(statements).toEqual([])
    expect(result).toEqual({
      exitCode: 1,
      log: [],
      errors: [
        "The count of rollback must be a positive integer or all, not 0\nRun with --help to list the commands.",
      ],
    })
  })
})

describe("runCli without a database", () => {
  // A database that rejects every statement, which the commands below never run.
  const db = createDatabase({
    driver: {
      closesReservedConnections: true,
      execute: rejectStatement,
      executeScript: rejectStatement,
      acquire: rejectStatement,
      close: async () => {},
    },
  })

  it("prints the usage of --help, and the usage as an error without a command", async () => {
    expect(await run(db, ["--help"])).toEqual({ exitCode: 0, log: [usage], errors: [] })
    expect(await run(db, [])).toEqual({ exitCode: 1, log: [], errors: [usage] })
  })

  describe("new", () => {
    let root: string

    beforeEach(async () => {
      root = await mkdtemp(join(tmpdir(), "kern-migrations-cli-"))
    })

    afterEach(async () => {
      await rm(root, { recursive: true, force: true })
    })

    it("creates the module of the next migration in the directory of a URL, writes the list module, and prints their paths", async () => {
      const directory = pathToFileURL(join(root, "migrations/"))

      const result = await run(db, ["new", "create_tag"], {
        directory,
        listModule: { path: new URL("index.ts", directory), extensions: false },
      })

      expect(result).toEqual({
        exitCode: 0,
        log: [
          `Created ${relative(process.cwd(), join(root, "migrations/0003_create_tag.ts"))}`,
          `Wrote ${relative(process.cwd(), join(root, "migrations/index.ts"))}`,
        ],
        errors: [],
      })
      expect((await readdir(join(root, "migrations"))).sort()).toEqual([
        "0003_create_tag.ts",
        "index.ts",
      ])
    })

    it("takes a list module of a path", async () => {
      const directory = join(root, "migrations")

      const result = await run(db, ["new", "create_tag"], {
        directory,
        listModule: join(root, "migrations.ts"),
      })

      expect(result.log[1]).toBe(`Wrote ${relative(process.cwd(), join(root, "migrations.ts"))}`)
    })

    it("requires the directory option", async () => {
      const result = await run(db, ["new", "create_tag"])

      expect(result).toEqual({
        exitCode: 1,
        log: [],
        errors: [new Error("The command new requires the directory option of runMigrationCli")],
      })
    })
  })
})

/** Rejects a statement of a database that a test must not query. */
async function rejectStatement(): Promise<never> {
  throw new Error("The test must not query the database")
}

/** Returns a loader of a module whose default export is `migration`. */
function loadMigration(migration: unknown): MigrationLoader {
  return async () => ({ default: migration })
}
