import { describe, expect, it } from "bun:test"

import type { Database, Driver } from "kern-db"
import { bindSchema, defineSchema, defineTable } from "kern-orm"
import * as t from "kern-orm/types"
import postgres from "postgres"

import { countLockWaiters, settleWithin, waitFor } from "../testing/concurrency"
import { describePooledPostgres, describePostgres } from "../testing/postgres"

import { MigrationError } from "./error"
import { createExtension } from "./helpers/extensions"
import { defineMigrations } from "./history"
import { getMigrationStatus, migrate, redo, rollback } from "./migrate"
import type { MigrationDatabase } from "./migration"

const form = defineTable("form", {
  id: t.integer.primaryKey(),
})

const schema = defineSchema({ form })

const createForm = {
  up: "CREATE TABLE form (id integer PRIMARY KEY)",
  down: "DROP TABLE form",
}

const createUser = {
  up: "CREATE TABLE app_user (id integer PRIMARY KEY)",
  down: "DROP TABLE app_user",
}

const createTag = {
  up: "CREATE TABLE tag (id integer PRIMARY KEY)",
  down: "DROP TABLE tag",
}

const createJob = {
  up: "CREATE TABLE job (id integer PRIMARY KEY)",
  down: "DROP TABLE job",
}

const indexForm = {
  up: "CREATE INDEX form_id_idx ON form (id)",
  down: "DROP INDEX form_id_idx",
  outsideTransaction: {
    // `IF [NOT] EXISTS` makes the changes safe to run again in these tests, which leave no index that is not valid.
    up: "CREATE INDEX CONCURRENTLY IF NOT EXISTS form_id_idx ON form (id)",
    down: "DROP INDEX CONCURRENTLY IF EXISTS form_id_idx",
  },
}

it.each([
  ["migrate", migrate],
  ["rollback", rollback],
  ["redo", redo],
  ["getMigrationStatus", getMigrationStatus],
] as const)(
  "%s rejects a value that is not a target, such as a client of PostgreSQL, with TypeError before checking its options",
  async (_, call) => {
    // postgres.js connects only at the first query, which the call never sends.
    const sql = postgres("postgres://localhost/none")

    await expect(
      call(sql as never, defineMigrations({ "0001_create_form": createForm }), {
        count: 0,
        schemaName: "",
      }),
    ).rejects.toEqual(
      new TypeError(
        "The target of migrations must be a Db of kern-orm, or a Database or a driver of kern-db",
      ),
    )
  },
)

describe("options", () => {
  /** Driver that rejects every statement, so that a call that sends one rejects with its error. */
  const driver: Driver = {
    execute: () => Promise.reject(new Error("No statement runs")),
    executeScript: () => Promise.reject(new Error("No statement runs")),
    acquire: () => Promise.reject(new Error("No statement runs")),
    close: async () => {},
  }
  const history = defineMigrations({ "0001_create_form": createForm })

  it.each([
    ["migrate", migrate],
    ["rollback", rollback],
    ["redo", redo],
    ["getMigrationStatus", getMigrationStatus],
  ] as const)(
    "%s rejects a schemaName that is not a non-empty string with TypeError before any statement",
    async (_, call) => {
      for (const schemaName of [5, null, ""]) {
        await expect(call(driver, history, { schemaName: schemaName as never })).rejects.toEqual(
          new TypeError("schemaName must be a string that is not empty"),
        )
      }
    },
  )

  it.each([
    ["migrate", 1.5, migrate, "count must be a positive integer, not 1.5"],
    ["migrate", "all", migrate, "count must be a positive integer, not all"],
    ["redo", 0, redo, "count must be a positive integer, not 0"],
    ["rollback", -1, rollback, 'count must be a positive integer or "all", not -1'],
  ] as const)(
    "%s rejects count %p with TypeError before any statement",
    async (_, count, call, message) => {
      await expect(call(driver, history, { count: count as never })).rejects.toEqual(
        new TypeError(message),
      )
    },
  )
})

describePostgres("migrate", ({ database, testTransaction, recordStatements, notices }) => {
  const db = bindSchema(schema, database, { schemaName: "migrations_tenant" })

  it("applies the pending migrations in the target schema of a Db in order and resolves to their keys", async () => {
    const history = defineMigrations({
      "0001_create_form": createForm,
      "0002_insert_form": {
        up: async database => await database.query`INSERT INTO form (id) VALUES (1)`,
      },
    })

    const result = await testTransaction(async () => ({
      keys: await migrate(db, history),
      forms: await db.form.select("id"),
      versions: await listVersions(database),
    }))

    expect(result).toEqual({
      keys: ["0001_create_form", "0002_insert_form"],
      forms: [{ id: 1 }],
      versions: ["0001_create_form", "0002_insert_form"],
    })
  })

  it("gives the functions of steps execute, which runs a statement in the target schema and returns its values as text", async () => {
    let rows: unknown
    const history = defineMigrations({
      "0001_read_schema": {
        up: async database => {
          rows = (await database.execute({ text: "SELECT current_schema()", parameters: [] })).rows
        },
      },
    })

    await testTransaction(() => migrate(db, history))

    expect(rows).toEqual([["migrations_tenant"]])
  })

  it("applies only the migrations that a history adds after the applied ones", async () => {
    const keys = await testTransaction(async () => {
      await migrate(db, defineMigrations({ "0001_create_form": createForm }))
      return await migrate(
        db,
        defineMigrations({ "0001_create_form": createForm, "0002_create_user": createUser }),
      )
    })

    expect(keys).toEqual(["0002_create_user"])
  })

  it("applies the first pending migrations of count", async () => {
    const history = defineMigrations({
      "0001_create_form": createForm,
      "0002_create_user": createUser,
      "0003_create_tag": createTag,
    })

    const keys = await testTransaction(async () => [
      await migrate(db, history, { count: 1 }),
      await migrate(db, history, { count: 5 }),
    ])

    expect(keys).toEqual([["0001_create_form"], ["0002_create_user", "0003_create_tag"]])
  })

  it("applies nothing to a target that is up to date, with two statements outside a transaction", async () => {
    const history = defineMigrations({ "0001_create_form": createForm })

    const result = await testTransaction(async () => {
      await migrate(db, history)
      let keys: string[] = []
      const statements = await recordStatements(async () => {
        keys = await migrate(db, history)
      })
      return { keys, commands: statements.map(text => text.split(" ", 1)[0]) }
    })

    // A test transaction runs each statement outside a transaction in a savepoint of its own, while a transaction would wrap both in one.
    expect(result).toEqual({
      keys: [],
      commands: ["SAVEPOINT", "SELECT", "RELEASE", "SAVEPOINT", "SELECT", "RELEASE"],
    })
  })

  it("creates the target schema and the table of versions, and the table in an existing schema, without notices", async () => {
    const history = defineMigrations({ "0001_create_form": createForm })
    notices.length = 0

    const tables = await testTransaction(async () => {
      await migrate(db, history)
      await database.script("CREATE SCHEMA migrations_tenant_2")
      await migrate(db, history, { schemaName: "migrations_tenant_2" })
      return [
        await listTables(database, "migrations_tenant"),
        await listTables(database, "migrations_tenant_2"),
      ]
    })

    expect(tables).toEqual([
      ["form", "kern_migration"],
      ["form", "kern_migration"],
    ])
    expect(notices).toEqual([])
  })

  it("keeps the applied migrations in the table of versions of the history", async () => {
    const history = defineMigrations({ "0001_create_form": createForm }, { tableName: "migration" })

    const tables = await testTransaction(async () => {
      await migrate(db, history)
      return await listTables(database, "migrations_tenant")
    })

    expect(tables).toEqual(["form", "migration"])
  })

  it("applies, rolls back, and lists histories of the target with different tables of versions independently, such as of a package and the application", async () => {
    // The history of the package numbers its migrations as the application does.
    const jobHistory = defineMigrations(
      { "0001_create_job": createJob },
      { tableName: "job_migration" },
    )
    const appHistory = defineMigrations({
      "0001_create_form": createForm,
      "0002_create_user": createUser,
    })

    /** Lists the migrations of both histories and the tables of the target. */
    async function describeTarget() {
      const job = await getMigrationStatus(db, jobHistory)
      const app = await getMigrationStatus(db, appHistory)
      return {
        job: { applied: job.applied, pending: job.pending, unknown: job.unknown },
        app: { applied: app.applied, pending: app.pending, unknown: app.unknown },
        tables: await listTables(database, "migrations_tenant"),
      }
    }

    const result = await testTransaction(async () => {
      const migrated = [await migrate(db, jobHistory), await migrate(db, appHistory)]
      const jobRolledBack = await rollback(db, jobHistory)
      const afterJobRollback = await describeTarget()
      await migrate(db, jobHistory)
      const appRolledBack = await rollback(db, appHistory, { count: "all" })
      return {
        migrated,
        jobRolledBack,
        afterJobRollback,
        appRolledBack,
        afterAppRollback: await describeTarget(),
      }
    })

    expect(result).toEqual({
      migrated: [["0001_create_job"], ["0001_create_form", "0002_create_user"]],
      jobRolledBack: ["0001_create_job"],
      afterJobRollback: {
        job: { applied: [], pending: ["0001_create_job"], unknown: [] },
        app: { applied: ["0001_create_form", "0002_create_user"], pending: [], unknown: [] },
        tables: ["app_user", "form", "job_migration", "kern_migration"],
      },
      appRolledBack: ["0002_create_user", "0001_create_form"],
      afterAppRollback: {
        job: { applied: ["0001_create_job"], pending: [], unknown: [] },
        app: { applied: [], pending: ["0001_create_form", "0002_create_user"], unknown: [] },
        tables: ["job", "job_migration", "kern_migration"],
      },
    })
  })

  it("rejects a schema or table name longer than PostgreSQL identifiers before changing anything", async () => {
    // 64 bytes: PostgreSQL truncates an identifier to 63 bytes, and a Cyrillic letter takes two bytes in UTF-8.
    const longTableName = "t".repeat(64)
    const longSchemaName = "я".repeat(32)

    const result = await testTransaction(async () => ({
      table: await migrate(
        db,
        defineMigrations({ "0001_create_form": createForm }, { tableName: longTableName }),
      ).catch((error: unknown) => (error as Error).message),
      schema: await migrate(db, defineMigrations({ "0001_create_form": createForm }), {
        schemaName: longSchemaName,
      }).catch((error: unknown) => (error as Error).message),
      tables: await listTables(database, "migrations_tenant"),
    }))

    expect(result).toEqual({
      table: `Cannot use table name ${longTableName}: it is longer than 63 bytes, and PostgreSQL would truncate it`,
      schema: `Cannot use schema name ${longSchemaName}: it is longer than 63 bytes, and PostgreSQL would truncate it`,
      tables: [],
    })
  })

  it("resolves unqualified names in the target schema followed by the schemas of the history, and restores the search path of the enclosing transaction", async () => {
    const history = defineMigrations(
      { "0001_create_form": { up: "CREATE TABLE form (id integer DEFAULT next_form_id())" } },
      { searchPath: ["migrations_extensions"] },
    )

    const result = await testTransaction(async () => {
      await database.script(`
        CREATE SCHEMA migrations_extensions;
        CREATE FUNCTION migrations_extensions.next_form_id() RETURNS integer LANGUAGE sql AS 'SELECT 7';
      `)
      const searchPath = await getSearchPath(database)
      await migrate(db, history)
      await database.query`INSERT INTO migrations_tenant.form DEFAULT VALUES`
      return {
        searchPathRestored: (await getSearchPath(database)) === searchPath,
        forms: await db.form.select("id"),
      }
    })

    expect(result).toEqual({ searchPathRestored: true, forms: [{ id: 7 }] })
  })

  it("targets the schema of the schemaName option instead of that of the Db, such as of a tenant that is being created", async () => {
    let calls = 0
    const tenantDb = bindSchema(schema, database, {
      schemaName: () => {
        calls++
        return "migrations_tenant"
      },
    })
    const history = defineMigrations({ "0001_create_form": createForm })

    const tables = await testTransaction(async () => {
      await migrate(tenantDb, history, { schemaName: "migrations_tenant_2" })
      return await listTables(database, "migrations_tenant_2")
    })

    expect(tables).toEqual(["form", "kern_migration"])
    expect(calls).toBe(0)
  })

  it("resolves the schema of a Db once per call", async () => {
    let calls = 0
    const tenantDb = bindSchema(schema, database, {
      schemaName: () => {
        calls++
        return "migrations_tenant"
      },
    })

    await testTransaction(async () => {
      await migrate(tenantDb, defineMigrations({ "0001_create_form": createForm }))
    })

    expect(calls).toBe(1)
  })

  it("targets current_schema() of a Database", async () => {
    const history = defineMigrations({ "0001_create_form": createForm })

    const result = await testTransaction(async () => {
      await database.script("CREATE SCHEMA migrations_current")
      const status = await database.transaction(
        async () => {
          await migrate(database, history)
          return await getMigrationStatus(database, history)
        },
        { searchPath: ["migrations_current"] },
      )
      return { status, tables: await listTables(database, "migrations_current") }
    })

    expect(result).toEqual({
      status: {
        schemaName: "migrations_current",
        applied: ["0001_create_form"],
        pending: [],
        unknown: [],
      },
      tables: ["form", "kern_migration"],
    })
  })

  it("targets the schema of the schemaName option of a Database", async () => {
    const history = defineMigrations({ "0001_create_form": createForm })
    const target = { schemaName: "migrations_tenant" }

    const result = await testTransaction(async () => ({
      migrated: await migrate(database, history, target),
      tables: await listTables(database, "migrations_tenant"),
      status: await getMigrationStatus(database, history, target),
      rolledBack: await rollback(database, history, target),
      tablesAfterRollback: await listTables(database, "migrations_tenant"),
    }))

    expect(result).toEqual({
      migrated: ["0001_create_form"],
      tables: ["form", "kern_migration"],
      status: {
        schemaName: "migrations_tenant",
        applied: ["0001_create_form"],
        pending: [],
        unknown: [],
      },
      rolledBack: ["0001_create_form"],
      tablesAfterRollback: ["kern_migration"],
    })
  })

  it("rejects a Database whose search path has no existing schema", async () => {
    await testTransaction(async () => {
      await expect(
        database.transaction(
          () => migrate(database, defineMigrations({ "0001_create_form": createForm })),
          { searchPath: ["migrations_missing"] },
        ),
      ).rejects.toThrow(
        "Cannot resolve the target schema: current_schema() is NULL, since no schema of the search path exists; pass schemaName",
      )
    })
  })

  it("runs inside a transaction as a nested transaction, which the enclosing one rolls back", async () => {
    const history = defineMigrations({ "0001_create_form": createForm })
    const failure = new Error("failure")

    const status = await testTransaction(async () => {
      await expect(
        database.transaction(async () => {
          await migrate(db, history)
          throw failure
        }),
      ).rejects.toBe(failure)
      return await getMigrationStatus(db, history)
    })

    expect(status).toEqual({
      schemaName: "migrations_tenant",
      applied: [],
      pending: ["0001_create_form"],
      unknown: [],
    })
  })

  it("runs up and down of a step with outsideTransaction in a test transaction", async () => {
    const history = defineMigrations({
      "0001_create_form": createForm,
      "0002_index_form": indexForm,
    })

    const statements = await testTransaction(() =>
      recordStatements(async () => {
        await migrate(db, history)
        await rollback(db, history)
      }),
    )

    expect(statements).toEqual(expect.arrayContaining([indexForm.up, indexForm.down]))
    expect(statements.filter(text => text.includes("CONCURRENTLY"))).toEqual([])
  })

  it("rolls back every migration of the call when a step fails, and rejects with a MigrationError of its key and step", async () => {
    const history = defineMigrations({
      "0001_create_form": createForm,
      "0002_create_user": [createUser, { up: "CREATE TABLE form (id integer)" }],
    })

    const result = await testTransaction(async () => ({
      error: await migrate(db, history).catch((error: unknown) => error),
      status: await getMigrationStatus(db, history),
    }))

    expect(result.error).toBeInstanceOf(MigrationError)
    expect(result.error).toMatchObject({
      message: 'Migration 0002_create_user failed in up of step 2: relation "form" already exists',
      key: "0002_create_user",
      step: 2,
      direction: "up",
      cause: expect.objectContaining({ message: 'relation "form" already exists' }),
    })
    expect(result.status.applied).toEqual([])
  })

  it("loads the pending migrations before applying any", async () => {
    let applied = false
    const failure = new Error("Cannot find module")
    const history = defineMigrations({
      "0001_create_form": async () => ({
        default: {
          up: async () => {
            applied = true
          },
        },
      }),
      "0002_create_user": () => Promise.reject(failure),
    })

    await testTransaction(async () => {
      await expect(migrate(db, history)).rejects.toThrow(
        "Cannot load migration 0002_create_user: Cannot find module",
      )
    })

    expect(applied).toBe(false)
  })

  describe("history and applied migrations", () => {
    const newHistory = defineMigrations({
      "0001_create_form": createForm,
      "0002_create_user": createUser,
      "0003_create_tag": createTag,
    })

    it("allows applied migrations after the last migration of the history, such as of a newer version of the application", async () => {
      const oldHistory = defineMigrations({
        "0001_create_form": createForm,
        "0002_create_user": createUser,
      })

      const result = await testTransaction(async () => {
        await migrate(db, newHistory)
        return {
          keys: await migrate(db, oldHistory),
          status: await getMigrationStatus(db, oldHistory),
        }
      })

      expect(result).toEqual({
        keys: [],
        status: {
          schemaName: "migrations_tenant",
          applied: ["0001_create_form", "0002_create_user"],
          pending: [],
          unknown: ["0003_create_tag"],
        },
      })
    })

    it("rejects an applied migration that the history lacks before its last migration", async () => {
      await testTransaction(async () => {
        await migrate(db, newHistory)
        await expect(
          migrate(
            db,
            defineMigrations({
              "0001_create_form": createForm,
              "0003_create_tag": createTag,
              "0004_drop_tag": { up: "DROP TABLE tag" },
            }),
          ),
        ).rejects.toThrow(
          'Cannot migrate schema "migrations_tenant": migration 0002_create_user is applied, but the history lacks it',
        )
      })
    })

    it("rejects a pending migration before an applied one, such as of a merged branch", async () => {
      await testTransaction(async () => {
        await migrate(
          db,
          defineMigrations({ "0001_create_form": createForm, "0003_create_tag": createTag }),
        )
        await expect(migrate(db, newHistory)).rejects.toThrow(
          'Cannot migrate schema "migrations_tenant": migration 0002_create_user is pending, but the later migration 0003_create_tag is applied',
        )
      })
    })
  })

  describe("rollback", () => {
    /** History whose steps record the changes that run, such as `0001:up:1` for `up` of step 1 of migration `0001_…`. */
    function defineRecordingHistory(changes: string[]) {
      const recordChange = (change: string) => async () => {
        changes.push(change)
      }
      return defineMigrations({
        "0001_create_form": { up: recordChange("0001:up"), down: recordChange("0001:down") },
        "0002_create_user": [
          { up: recordChange("0002:up:1"), down: recordChange("0002:down:1") },
          { up: recordChange("0002:up:2") },
          { up: recordChange("0002:up:3"), down: recordChange("0002:down:3") },
        ],
      })
    }

    it("rolls back the last applied migration, running down of its steps in reverse order and skipping steps without down", async () => {
      const changes: string[] = []
      const history = defineRecordingHistory(changes)

      const result = await testTransaction(async () => {
        await migrate(db, history)
        changes.length = 0
        return {
          keys: await rollback(db, history),
          status: await getMigrationStatus(db, history),
        }
      })

      expect(result).toEqual({
        keys: ["0002_create_user"],
        status: {
          schemaName: "migrations_tenant",
          applied: ["0001_create_form"],
          pending: ["0002_create_user"],
          unknown: [],
        },
      })
      expect(changes).toEqual(["0002:down:3", "0002:down:1"])
    })

    it("rolls back a given number of migrations, or all, in reverse order", async () => {
      const changes: string[] = []
      const history = defineRecordingHistory(changes)

      const keys = await testTransaction(async () => {
        await migrate(db, history)
        const rolledBack = await rollback(db, history, { count: "all" })
        await migrate(db, history)
        return [rolledBack, await rollback(db, history, { count: 5 })]
      })

      expect(keys).toEqual([
        ["0002_create_user", "0001_create_form"],
        ["0002_create_user", "0001_create_form"],
      ])
    })

    it("keeps every migration applied when down of one fails, and rejects with a MigrationError of its key and step", async () => {
      const history = defineMigrations({
        "0001_create_form": { up: createForm.up, down: "DROP TABLE missing_form" },
        "0002_create_user": createUser,
      })

      const result = await testTransaction(async () => {
        await migrate(db, history)
        return {
          error: await rollback(db, history, { count: 2 }).catch((error: unknown) => error),
          status: await getMigrationStatus(db, history),
          tables: await listTables(database, "migrations_tenant"),
        }
      })

      expect(result.error).toBeInstanceOf(MigrationError)
      expect(result.error).toMatchObject({
        message:
          'Migration 0001_create_form failed in down of step 1: table "missing_form" does not exist',
        key: "0001_create_form",
        step: 1,
        direction: "down",
      })
      expect(result.status.applied).toEqual(["0001_create_form", "0002_create_user"])
      expect(result.tables).toEqual(["app_user", "form", "kern_migration"])
    })

    it("rolls back nothing without a transaction when the target has no table of versions", async () => {
      const result = await testTransaction(async () => {
        let keys: string[] = []
        const statements = await recordStatements(async () => {
          keys = await rollback(db, defineMigrations({ "0001_create_form": createForm }))
        })
        return { keys, commands: statements.map(text => text.split(" ", 1)[0]) }
      })

      // A test transaction runs a statement outside a transaction in a savepoint of its own; a transaction would also take the lock of the target.
      expect(result).toEqual({ keys: [], commands: ["SAVEPOINT", "SELECT", "RELEASE"] })
    })

    it("rejects an applied migration that the history lacks, since it cannot roll it back", async () => {
      await testTransaction(async () => {
        await migrate(
          db,
          defineMigrations({ "0001_create_form": createForm, "0002_create_user": createUser }),
        )
        await expect(
          rollback(db, defineMigrations({ "0001_create_form": createForm })),
        ).rejects.toThrow(
          'Cannot roll back the migrations of schema "migrations_tenant": migration 0002_create_user is applied, but the history lacks it',
        )
      })
    })

    it("redo rolls back the last applied migrations and applies them again", async () => {
      const changes: string[] = []
      const history = defineRecordingHistory(changes)

      const result = await testTransaction(async () => {
        await migrate(db, history)
        changes.length = 0
        return {
          keys: await redo(db, history, { count: 2 }),
          status: await getMigrationStatus(db, history),
        }
      })

      expect(result).toEqual({
        keys: ["0001_create_form", "0002_create_user"],
        status: {
          schemaName: "migrations_tenant",
          applied: ["0001_create_form", "0002_create_user"],
          pending: [],
          unknown: [],
        },
      })
      expect(changes).toEqual([
        "0002:down:3",
        "0002:down:1",
        "0001:down",
        "0001:up",
        "0002:up:1",
        "0002:up:2",
        "0002:up:3",
      ])
    })

    it("redo keeps the migration applied when applying it again fails", async () => {
      const history = defineMigrations({
        "0001_create_form": { up: createForm.up, down: "DELETE FROM form" },
      })

      const result = await testTransaction(async () => {
        await migrate(db, history)
        await database.query`INSERT INTO migrations_tenant.form (id) VALUES (1)`
        return {
          error: await redo(db, history).catch((error: unknown) => (error as Error).message),
          status: await getMigrationStatus(db, history),
          forms: await db.form.select("id"),
        }
      })

      expect(result).toEqual({
        error: 'Migration 0001_create_form failed in up of step 1: relation "form" already exists',
        status: {
          schemaName: "migrations_tenant",
          applied: ["0001_create_form"],
          pending: [],
          unknown: [],
        },
        forms: [{ id: 1 }],
      })
    })
  })
})

describePooledPostgres(
  "outside a transaction",
  ({ database, driver, recordStatements, failStatement, connect }) => {
    const db = bindSchema(schema, database)
    const target = { schemaName: "migrations_pool_1" }
    const history = defineMigrations({
      "0001_create_form": createForm,
      "0002_index_form": indexForm,
      "0003_create_user": createUser,
    })

    /** Operations that a scenario started, and the gate that holds the migrations that wait for it. */
    interface Scenario {
      readonly gate: Promise<void>
      openGate(): void
      /** Registers an operation, such as `migrate`, which the scenario waits for before dropping the schemas. */
      start<T>(operation: Promise<T>): Promise<T>
    }

    /** Runs `scenario`, then opens its gate, waits for the operations it started, and drops the schemas that the migrations committed. */
    async function runScenario(scenario: (context: Scenario) => Promise<void>): Promise<void> {
      const gate = Promise.withResolvers<void>()
      const operations: Promise<unknown>[] = []
      try {
        await scenario({
          gate: gate.promise,
          openGate: gate.resolve,
          start(operation) {
            operations.push(operation)
            // Keeps a rejection before the scenario awaits the operation from being reported as unhandled.
            operation.catch(() => {})
            return operation
          },
        })
      } finally {
        gate.resolve()
        await Promise.allSettled(operations)
        // Keeps PostgreSQL from sending a notice of each table that the drop cascades to.
        await database.script(`
          SET LOCAL client_min_messages = warning;
          DROP SCHEMA IF EXISTS migrations_pool_1, migrations_pool_2, migrations_pool_extensions CASCADE;
        `)
      }
    }

    /** Change that counts its runs in `runs` and waits for `gate` before running `sql`. */
    function waitBefore(sql: string, gate: Promise<void>, runs: { count: number }) {
      return async (database: MigrationDatabase) => {
        runs.count++
        await gate
        await database.script(sql)
      }
    }

    it("migrates a Driver on a database of its own, outside the transaction of the database of the application, and leaves the driver open", async () => {
      const rolledBack = new Error("rolled back")
      let result = {}
      await runScenario(async () => {
        let migrated: string[] = []
        await expect(
          database.transaction(async () => {
            migrated = await migrate(driver, history, target)
            throw rolledBack
          }),
        ).rejects.toBe(rolledBack)
        result = {
          migrated,
          status: await getMigrationStatus(driver, history, target),
          tables: await listTables(database, "migrations_pool_1"),
        }
      })

      expect(result).toEqual({
        migrated: ["0001_create_form", "0002_index_form", "0003_create_user"],
        status: {
          schemaName: "migrations_pool_1",
          applied: ["0001_create_form", "0002_index_form", "0003_create_user"],
          pending: [],
          unknown: [],
        },
        tables: ["app_user", "form", "kern_migration"],
      })
    })

    it("runs a migration with outsideTransaction alone in a session after the migrations before it commit, and records it after it", async () => {
      let statements: string[] = []
      await runScenario(async () => {
        statements = await recordStatements(() => migrate(db, history, target))
      })

      expect(nameStatements(statements)).toEqual([
        "read target",
        "read search path",
        "set search path",
        "try lock",
        "read target",
        "BEGIN ISOLATION LEVEL READ COMMITTED",
        "create schema",
        "create table of versions",
        createForm.up,
        "insert version",
        "COMMIT",
        indexForm.outsideTransaction.up,
        "insert version",
        "BEGIN ISOLATION LEVEL READ COMMITTED",
        createUser.up,
        "insert version",
        "COMMIT",
        "unlock",
        "set search path",
      ])
    })

    it("creates the schema and the table of versions before a first migration outside a transaction", async () => {
      const outsideFirst = defineMigrations({
        "0001_create_form": { ...createForm, outsideTransaction: { up: createForm.up } },
      })
      let statements: string[] = []
      let applied: readonly string[] = []

      await runScenario(async () => {
        statements = await recordStatements(() => migrate(db, outsideFirst, target))
        applied = (await getMigrationStatus(db, outsideFirst, target)).applied
      })

      expect(listChanges(statements)).toEqual([
        "BEGIN ISOLATION LEVEL READ COMMITTED",
        "create schema",
        "create table of versions",
        "COMMIT",
        createForm.up,
        "insert version",
      ])
      expect(applied).toEqual(["0001_create_form"])
    })

    it("migrates a target that is up to date with two statements and no session", async () => {
      await runScenario(async () => {
        await migrate(db, history, target)
        const statements = await recordStatements(() => migrate(db, history, target))

        expect(nameStatements(statements)).toEqual(["read target", "read versions"])
      })
    })

    it("rolls back and redoes the last migrations of both kinds, each migration counting once", async () => {
      await runScenario(async () => {
        await migrate(db, history, target)
        let keys: string[][] = []
        const statements = await recordStatements(async () => {
          keys = [
            await redo(db, history, { ...target, count: 3 }),
            await rollback(db, history, { ...target, count: 2 }),
          ]
        })

        expect(keys).toEqual([
          ["0001_create_form", "0002_index_form", "0003_create_user"],
          ["0003_create_user", "0002_index_form"],
        ])
        expect(listChanges(statements)).toEqual([
          "BEGIN ISOLATION LEVEL READ COMMITTED",
          createUser.down,
          "delete version",
          "COMMIT",
          indexForm.outsideTransaction.down,
          "delete version",
          "BEGIN ISOLATION LEVEL READ COMMITTED",
          createForm.down,
          "delete version",
          createForm.up,
          "insert version",
          "COMMIT",
          indexForm.outsideTransaction.up,
          "insert version",
          "BEGIN ISOLATION LEVEL READ COMMITTED",
          createUser.up,
          "insert version",
          "COMMIT",
          "BEGIN ISOLATION LEVEL READ COMMITTED",
          createUser.down,
          "delete version",
          "COMMIT",
          indexForm.outsideTransaction.down,
          "delete version",
        ])
      })
    })

    it("runs up and down of a step with outsideTransaction inside a transaction", async () => {
      await runScenario(async () => {
        const statements = await recordStatements(() =>
          database.transaction(async () => {
            await migrate(db, history, target)
            await rollback(db, history, { ...target, count: 2 })
          }),
        )

        expect(statements).toEqual(expect.arrayContaining([indexForm.up, indexForm.down]))
        expect(statements.filter(text => text.includes("CONCURRENTLY"))).toEqual([])
      })
    })

    it("rejects a call that has migrations to run in a transaction at repeatable read or serializable before locking the target, and resolves to none without them", async () => {
      await runScenario(async () => {
        let error: unknown
        const statements = await recordStatements(async () => {
          error = await database
            .transaction(() => migrate(db, history, target), { isolation: "serializable" })
            .catch((error: unknown) => (error as Error).message)
        })
        await migrate(db, history, target)
        // A call that rejects leaves the enclosing transaction usable.
        const calls = await database.transaction(
          async () => ({
            migrate: await migrate(db, history, target),
            rollback: await rollback(db, history, target).catch(
              (error: unknown) => (error as Error).message,
            ),
            redo: await redo(db, history, target).catch(
              (error: unknown) => (error as Error).message,
            ),
          }),
          { isolation: "repeatable read" },
        )

        expect(error).toBe(
          'Cannot migrate schema "migrations_pool_1" in a transaction at isolation level serializable, whose snapshot misses the migrations that another process applies or rolls back meanwhile; run the call outside a transaction or in a transaction at read committed',
        )
        expect(nameStatements(statements)).toEqual([
          "BEGIN ISOLATION LEVEL SERIALIZABLE",
          "read target",
          "ROLLBACK",
        ])
        expect(calls).toEqual({
          migrate: [],
          rollback: expect.stringContaining(
            'Cannot roll back the migrations of schema "migrations_pool_1" in a transaction at isolation level repeatable read,',
          ),
          redo: expect.stringContaining(
            'Cannot redo the migrations of schema "migrations_pool_1" in a transaction at isolation level repeatable read,',
          ),
        })
        expect((await getMigrationStatus(db, history, target)).pending).toEqual([])
      })
    })

    it("rejects in a session, whose lock would last until the session ends, before changing anything", async () => {
      await runScenario(async () => {
        await expect(database.session(() => migrate(db, history, target))).rejects.toThrow(
          "Cannot start a session inside a session",
        )
        expect((await getMigrationStatus(db, history, target)).applied).toEqual([])
      })
    })

    it("keeps the migrations committed before a migration that fails outside a transaction, which the next call applies", async () => {
      let attempts = 0
      const failing = defineMigrations({
        "0001_create_form": createForm,
        "0002_index_form": {
          up: indexForm.up,
          down: indexForm.down,
          outsideTransaction: {
            up: async database => {
              attempts++
              if (attempts === 1) {
                throw new Error("interrupted")
              }
              await database.script(indexForm.outsideTransaction.up)
            },
          },
        },
        "0003_create_user": createUser,
      })

      await runScenario(async () => {
        const error = await migrate(db, failing, target).catch((error: unknown) => error)
        const status = await getMigrationStatus(db, failing, target)
        const keys = await migrate(db, failing, target)

        expect(error).toBeInstanceOf(MigrationError)
        expect(error).toMatchObject({
          message:
            "Migration 0002_index_form failed in up of step 1 outside a transaction: interrupted",
          key: "0002_index_form",
          step: 1,
          direction: "up",
        })
        expect(status).toMatchObject({
          applied: ["0001_create_form"],
          pending: ["0002_index_form", "0003_create_user"],
        })
        expect(keys).toEqual(["0002_index_form", "0003_create_user"])
        expect(await listFormIndexes(database, "migrations_pool_1")).toEqual([
          "form_id_idx",
          "form_pkey",
        ])
      })
    })

    describe("a failure between a change outside a transaction and its record", () => {
      const indexHistory = defineMigrations({
        "0001_create_form": createForm,
        "0002_index_form": indexForm,
      })

      it("applies the migration again on the next call after up", async () => {
        await runScenario(async () => {
          await migrate(db, indexHistory, { ...target, count: 1 })
          failStatement(text => text.startsWith("INSERT INTO"), new Error("connection lost"))
          const error = await migrate(db, indexHistory, target).catch(
            (error: unknown) => (error as Error).message,
          )
          const status = await getMigrationStatus(db, indexHistory, target)
          const indexes = await listFormIndexes(database, "migrations_pool_1")

          expect({ error, pending: status.pending, indexes }).toEqual({
            error: "connection lost",
            pending: ["0002_index_form"],
            indexes: ["form_id_idx", "form_pkey"],
          })
          expect(await migrate(db, indexHistory, target)).toEqual(["0002_index_form"])
        })
      })

      it("rolls the migration back again on the next call after down", async () => {
        await runScenario(async () => {
          await migrate(db, indexHistory, target)
          failStatement(text => text.startsWith("DELETE FROM"), new Error("connection lost"))
          const error = await rollback(db, indexHistory, target).catch(
            (error: unknown) => (error as Error).message,
          )
          const status = await getMigrationStatus(db, indexHistory, target)
          const indexes = await listFormIndexes(database, "migrations_pool_1")

          expect({ error, applied: status.applied, indexes }).toEqual({
            error: "connection lost",
            applied: ["0001_create_form", "0002_index_form"],
            indexes: ["form_pkey"],
          })
          expect(await rollback(db, indexHistory, target)).toEqual(["0002_index_form"])
          expect((await getMigrationStatus(db, indexHistory, target)).applied).toEqual([
            "0001_create_form",
          ])
        })
      })
    })

    describe("at once", () => {
      // Databases of other processes that migrate the target at once.
      const others = [connect(), connect()]

      /** Waits until each database of `contexts` finds the lock of a session held after the call, such as `migrate` that polls for the lock of its target. */
      async function waitForRefusedLocks(...contexts: { countRefusedLocks(): number }[]) {
        const counts = contexts.map(context => context.countRefusedLocks())
        await waitFor(async () =>
          contexts.every((context, index) => context.countRefusedLocks() > counts[index]!),
        )
      }

      it("applies each migration once when several databases migrate a target at once", async () => {
        const runs = { count: 0 }

        await runScenario(async ({ gate, openGate, start }) => {
          const waiting = defineMigrations({
            "0001_create_form": createForm,
            "0002_index_form": {
              ...indexForm,
              outsideTransaction: {
                ...indexForm.outsideTransaction,
                up: waitBefore(indexForm.outsideTransaction.up, gate, runs),
              },
            },
          })
          const first = start(migrate(db, waiting, target))
          await waitFor(async () => runs.count === 1)
          const refused = waitForRefusedLocks(...others)
          const rest = others.map(other => start(migrate(other.database, waiting, target)))
          await refused
          openGate()

          expect([await first, ...(await Promise.all(rest))]).toEqual([
            ["0001_create_form", "0002_index_form"],
            [],
            [],
          ])
        })

        expect(runs.count).toBe(1)
      })

      it("waits in a transaction for a process that migrates the target in a session", async () => {
        const runs = { count: 0 }
        const [other] = others

        await runScenario(async ({ gate, openGate, start }) => {
          const waiting = defineMigrations({
            "0001_create_form": { up: waitBefore(createForm.up, gate, runs) },
          })
          const first = start(migrate(db, waiting, target))
          await waitFor(async () => runs.count === 1)
          const second = start(
            other!.database.transaction(() => migrate(other!.database, waiting, target)),
          )
          await waitFor(
            async () =>
              (await countLockWaiters(database, '"migrations_pool_1"."kern_migration"')) === 1,
          )
          openGate()

          expect([await first, await second]).toEqual([["0001_create_form"], []])
        })

        expect(runs.count).toBe(1)
      })

      // rake-db 2.37.48 locked every target with one key, so a migration of one target blocked all others: https://github.com/romeerez/orchid-orm/issues/771
      it("migrates different targets at once", async () => {
        const runs = { count: 0 }

        await runScenario(async ({ gate, openGate, start }) => {
          const waiting = defineMigrations({
            "0001_create_form": { up: waitBefore(createForm.up, gate, runs) },
          })
          const first = start(migrate(db, waiting, target))
          await waitFor(async () => runs.count === 1)
          const second = await settleWithin(
            start(
              migrate(db, defineMigrations({ "0001_create_form": createForm }), {
                schemaName: "migrations_pool_2",
              }),
            ),
          )
          openGate()

          expect([await first, second]).toEqual([["0001_create_form"], ["0001_create_form"]])
        })
      })

      it("migrates histories of one target with different tables of versions at once", async () => {
        const runs = { count: 0 }

        await runScenario(async ({ gate, openGate, start }) => {
          // A history that creates a missing target schema keeps the others waiting until it commits.
          await database.script("CREATE SCHEMA migrations_pool_1")
          const waiting = defineMigrations({
            "0001_create_form": { up: waitBefore(createForm.up, gate, runs) },
          })
          const first = start(migrate(db, waiting, target))
          await waitFor(async () => runs.count === 1)
          const second = await settleWithin(
            start(
              migrate(
                db,
                defineMigrations({ "0001_create_job": createJob }, { tableName: "job_migration" }),
                target,
              ),
            ),
          )
          openGate()

          expect([await first, second]).toEqual([["0001_create_form"], ["0001_create_job"]])
        })
      })

      it("waits for another history of the target that creates the missing target schema, rather than failing on its unique name", async () => {
        const runs = { count: 0 }

        await runScenario(async ({ gate, openGate, start }) => {
          const waiting = defineMigrations({
            "0001_create_form": { up: waitBefore(createForm.up, gate, runs) },
          })
          // It creates the schema in the transaction of its migration, which waits for the gate.
          const first = start(migrate(db, waiting, target))
          await waitFor(async () => runs.count === 1)
          const second = start(
            migrate(
              db,
              defineMigrations({ "0001_create_job": createJob }, { tableName: "job_migration" }),
              target,
            ),
          )
          await waitFor(
            async () =>
              (await countLockWaiters(database, "kern-migrations schema migrations_pool_1")) === 1,
          )
          openGate()

          expect([await first, await second]).toEqual([["0001_create_form"], ["0001_create_job"]])
          expect(await listTables(database, "migrations_pool_1")).toEqual([
            "form",
            "job",
            "job_migration",
            "kern_migration",
          ])
        })
      })

      it("rolls back each migration once when processes roll back a target at once", async () => {
        const runs = { count: 0 }
        const [other] = others

        await runScenario(async ({ gate, openGate, start }) => {
          const waiting = defineMigrations({
            "0001_create_form": createForm,
            "0002_create_user": {
              up: createUser.up,
              down: waitBefore(createUser.down, gate, runs),
            },
          })
          await migrate(db, waiting, target)
          const first = start(rollback(db, waiting, target))
          await waitFor(async () => runs.count === 1)
          const refused = waitForRefusedLocks(other!)
          const second = start(rollback(other!.database, waiting, target))
          await refused
          openGate()

          expect([await first, await second]).toEqual([["0002_create_user"], ["0001_create_form"]])
        })

        expect(runs.count).toBe(1)
      })

      it("applies the migrations pending once it takes the lock, after another process rolls back migrations meanwhile", async () => {
        const runs = { count: 0 }
        const [other] = others

        await runScenario(async ({ gate, openGate, start }) => {
          const waiting = defineMigrations({
            "0001_create_form": {
              up: createForm.up,
              down: waitBefore(createForm.down, gate, runs),
            },
            "0002_index_form": indexForm,
            "0003_create_user": createUser,
          })
          await migrate(db, waiting, { ...target, count: 2 })
          // It rolls back 0002_index_form outside a transaction, and then waits in the transaction of 0001_create_form.
          const rolledBack = start(rollback(db, waiting, { ...target, count: 2 }))
          await waitFor(async () => runs.count === 1)
          let keys: string[] = []
          const statements = await other!.recordStatements(async () => {
            const refused = waitForRefusedLocks(other!)
            // Its first read finds 0002_index_form and 0003_create_user pending.
            const migrated = start(migrate(other!.database, waiting, target))
            await refused
            openGate()
            keys = await migrated
          })

          expect(await rolledBack).toEqual(["0002_index_form", "0001_create_form"])
          expect(keys).toEqual(["0001_create_form", "0002_index_form", "0003_create_user"])
          expect(listChanges(statements)).toEqual([
            "BEGIN ISOLATION LEVEL READ COMMITTED",
            createForm.up,
            "insert version",
            "COMMIT",
            indexForm.outsideTransaction.up,
            "insert version",
            "BEGIN ISOLATION LEVEL READ COMMITTED",
            createUser.up,
            "insert version",
            "COMMIT",
          ])
        })
      })

      describe("on databases whose transactions default to serializable", () => {
        const strict = [
          connect({ isolation: "serializable" }),
          connect({ isolation: "serializable" }),
        ]

        it("applies each migration once when two processes migrate a target at once", async () => {
          const runs = { count: 0 }
          const [holder, waiter] = strict

          await runScenario(async ({ gate, openGate, start }) => {
            const waiting = defineMigrations({
              "0001_create_form": { up: waitBefore(createForm.up, gate, runs) },
              "0002_create_user": createUser,
            })
            const held = start(migrate(holder!.database, waiting, target))
            await waitFor(async () => runs.count === 1)
            const refused = waitForRefusedLocks(waiter!)
            const waited = start(migrate(waiter!.database, waiting, target))
            await refused
            openGate()

            expect([await held, await waited]).toEqual([
              ["0001_create_form", "0002_create_user"],
              [],
            ])
          })

          expect(runs.count).toBe(1)
        })

        it("creates a missing extension once when processes migrate different targets at once", async () => {
          const runs = { count: 0 }
          const [holder, waiter] = strict

          await runScenario(async ({ gate, openGate, start }) => {
            const extension = createExtension("hstore", { schema: "migrations_pool_extensions" })
            const waiting = defineMigrations({
              "0001_create_hstore": [extension, { up: waitBefore(createForm.up, gate, runs) }],
            })
            // It creates the extension in the transaction of its migration, which waits for the gate.
            const held = start(migrate(holder!.database, waiting, target))
            await waitFor(async () => runs.count === 1)
            const waited = start(
              migrate(waiter!.database, defineMigrations({ "0001_create_hstore": extension }), {
                schemaName: "migrations_pool_2",
              }),
            )
            await waitFor(
              async () =>
                (await countLockWaiters(database, "kern-migrations createExtension")) === 1,
            )
            openGate()

            expect([await held, await waited]).toEqual([
              ["0001_create_hstore"],
              ["0001_create_hstore"],
            ])
          })
        })

        it("rejects a call in a transaction while another process migrates the target, before waiting for the lock", async () => {
          const runs = { count: 0 }
          const [holder, waiter] = strict

          await runScenario(async ({ gate, openGate, start }) => {
            const waiting = defineMigrations({
              "0001_create_form": { up: waitBefore(createForm.up, gate, runs) },
            })
            const held = start(migrate(holder!.database, waiting, target))
            await waitFor(async () => runs.count === 1)
            const { database: other } = waiter!

            await expect(
              settleWithin(other.transaction(() => migrate(other, waiting, target))),
            ).rejects.toThrow(
              'Cannot migrate schema "migrations_pool_1" in a transaction at isolation level serializable',
            )
            openGate()
            expect(await held).toEqual(["0001_create_form"])
          })

          expect(runs.count).toBe(1)
        })
      })
    })
  },
)

/** Names of the statements of the migrator and of its session by the start of their text. */
const statementNames: readonly (readonly [prefix: string, name: string])[] = [
  ["SELECT target.name", "read target"],
  ["SELECT key FROM", "read versions"],
  ["SELECT current_setting($1)", "read search path"],
  ["SELECT set_config($1, $2, false)", "set search path"],
  ["SELECT pg_try_advisory_lock(", "try lock"],
  ["SELECT pg_advisory_unlock(", "unlock"],
  ["DO $", "create schema"],
  ["CREATE TABLE IF NOT EXISTS", "create table of versions"],
  ["INSERT INTO", "insert version"],
  ["DELETE FROM", "delete version"],
]

/** Names the statements of the migrator and of its session, such as `try lock`, keeping the statements of migrations and transactions as they are. */
function nameStatements(texts: readonly string[]): string[] {
  return texts.map(text => statementNames.find(([prefix]) => text.startsWith(prefix))?.[1] ?? text)
}

/** Names of the statements that read a target or keep its session and lock rather than change it. */
const readingNames = new Set([
  "read target",
  "read versions",
  "read search path",
  "set search path",
  "try lock",
  "unlock",
])

/** Lists the statements of `texts` that change a target, with their transactions, naming those of the migrator. */
function listChanges(texts: readonly string[]): string[] {
  return nameStatements(texts).filter(name => !readingNames.has(name))
}

/** Lists the tables of PostgreSQL schema `schemaName` by name. */
async function listTables(database: Database, schemaName: string): Promise<string[]> {
  return await database.query`
    SELECT table_name FROM information_schema.tables WHERE table_schema = ${schemaName} ORDER BY table_name
  `.pluck(t.text)
}

/** Lists the indexes of table `form` of PostgreSQL schema `schemaName` by name. */
async function listFormIndexes(database: Database, schemaName: string): Promise<string[]> {
  return await database.query`
    SELECT indexname::text FROM pg_indexes WHERE schemaname = ${schemaName} AND tablename = 'form' ORDER BY indexname
  `.pluck(t.text)
}

/** Lists the keys of the table of versions of PostgreSQL schema `migrations_tenant` in order. */
async function listVersions(database: Database): Promise<string[]> {
  return await database.query`SELECT key FROM migrations_tenant.kern_migration ORDER BY key`.pluck(
    t.text,
  )
}

/** Reads the search path of the current transaction. */
async function getSearchPath(database: Database): Promise<string> {
  return await database.query`SELECT current_setting('search_path')`.get(t.text)
}
