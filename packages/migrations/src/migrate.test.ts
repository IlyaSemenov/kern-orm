import { describe, expect, it } from "bun:test"

import type { Database } from "kern-orm"
import { defineSchema, defineTable } from "kern-orm"
import * as t from "kern-orm/types"

import { describePooledPostgres, describePostgres } from "../testing/postgres"

import { MigrationError } from "./error"
import type { MigrationHistoryOptions, MigrationLoader } from "./history"
import { defineMigrations } from "./history"
import { getMigrationStatus, migrate, redo, rollback } from "./migrate"
import type { Migration, MigrationDatabase } from "./migration"

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

describePostgres("migrate", ({ database, testTransaction, recordStatements, notices }) => {
  const db = database.bind(schema, { schemaName: "migrations_tenant" })

  it("applies the pending migrations in the target schema of a Db in order and resolves to their keys", async () => {
    const history = defineTestHistory({
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

  it("applies only the migrations that a history adds after the applied ones", async () => {
    const keys = await testTransaction(async () => {
      await migrate(db, defineTestHistory({ "0001_create_form": createForm }))
      return await migrate(
        db,
        defineTestHistory({ "0001_create_form": createForm, "0002_create_user": createUser }),
      )
    })

    expect(keys).toEqual(["0002_create_user"])
  })

  it("applies nothing to a target that is up to date, with two statements outside a transaction", async () => {
    const history = defineTestHistory({ "0001_create_form": createForm })

    const result = await testTransaction(async () => {
      await migrate(db, history)
      let keys: string[] = []
      const statements = await recordStatements(async () => {
        keys = await migrate(db, history)
      })
      return { keys, commands: statements.map(text => text.split(" ", 1)[0]) }
    })

    expect(result).toEqual({ keys: [], commands: ["SELECT", "SELECT"] })
  })

  it("creates the target schema and the table of versions, and the table in an existing schema, without notices", async () => {
    const history = defineTestHistory({ "0001_create_form": createForm })
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
    const history = defineTestHistory(
      { "0001_create_form": createForm },
      { tableName: "migration" },
    )

    const tables = await testTransaction(async () => {
      await migrate(db, history)
      return await listTables(database, "migrations_tenant")
    })

    expect(tables).toEqual(["form", "migration"])
  })

  it("rejects a schema or table name longer than PostgreSQL identifiers before changing anything", async () => {
    // 64 bytes: PostgreSQL truncates an identifier to 63 bytes, and a Cyrillic letter takes two bytes in UTF-8.
    const longTableName = "t".repeat(64)
    const longSchemaName = "я".repeat(32)

    const result = await testTransaction(async () => ({
      table: await migrate(
        db,
        defineTestHistory({ "0001_create_form": createForm }, { tableName: longTableName }),
      ).catch((error: unknown) => (error as Error).message),
      schema: await migrate(db, defineTestHistory({ "0001_create_form": createForm }), {
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
    const history = defineTestHistory(
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
    const tenantDb = database.bind(schema, {
      schemaName: () => {
        calls++
        return "migrations_tenant"
      },
    })
    const history = defineTestHistory({ "0001_create_form": createForm })

    const tables = await testTransaction(async () => {
      await migrate(tenantDb, history, { schemaName: "migrations_tenant_2" })
      return await listTables(database, "migrations_tenant_2")
    })

    expect(tables).toEqual(["form", "kern_migration"])
    expect(calls).toBe(0)
  })

  it("resolves the schema of a Db once per call", async () => {
    let calls = 0
    const tenantDb = database.bind(schema, {
      schemaName: () => {
        calls++
        return "migrations_tenant"
      },
    })

    await testTransaction(async () => {
      await migrate(tenantDb, defineTestHistory({ "0001_create_form": createForm }))
    })

    expect(calls).toBe(1)
  })

  it("targets current_schema() of a Database", async () => {
    const tables = await testTransaction(async () => {
      await database.script("CREATE SCHEMA migrations_current")
      await database.transaction(
        () => migrate(database, defineTestHistory({ "0001_create_form": createForm })),
        { searchPath: ["migrations_current"] },
      )
      return await listTables(database, "migrations_current")
    })

    expect(tables).toEqual(["form", "kern_migration"])
  })

  it("targets the schema of the schemaName option of a Database", async () => {
    const history = defineTestHistory({ "0001_create_form": createForm })
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
      status: { applied: ["0001_create_form"], pending: [], unknown: [] },
      rolledBack: ["0001_create_form"],
      tablesAfterRollback: ["kern_migration"],
    })
  })

  it("rejects a Database whose search path has no existing schema", async () => {
    await testTransaction(async () => {
      await expect(
        database.transaction(
          () => migrate(database, defineTestHistory({ "0001_create_form": createForm })),
          { searchPath: ["migrations_missing"] },
        ),
      ).rejects.toThrow(
        "Cannot resolve the target schema: current_schema() is NULL, since no schema of the search path exists; pass schemaName",
      )
    })
  })

  it("runs inside a transaction as a nested transaction, which the enclosing one rolls back", async () => {
    const history = defineTestHistory({ "0001_create_form": createForm })
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

    expect(status).toEqual({ applied: [], pending: ["0001_create_form"], unknown: [] })
  })

  it("rolls back every migration of the call when a step fails, and rejects with a MigrationError of its key and step", async () => {
    const history = defineTestHistory({
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
    const newHistory = defineTestHistory({
      "0001_create_form": createForm,
      "0002_create_user": createUser,
      "0003_create_tag": createTag,
    })

    it("allows applied migrations after the last migration of the history, such as of a newer version of the application", async () => {
      const oldHistory = defineTestHistory({
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
            defineTestHistory({
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
          defineTestHistory({ "0001_create_form": createForm, "0003_create_tag": createTag }),
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
      return defineTestHistory({
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
        status: { applied: ["0001_create_form"], pending: ["0002_create_user"], unknown: [] },
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
      const history = defineTestHistory({
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
          keys = await rollback(db, defineTestHistory({ "0001_create_form": createForm }))
        })
        return { keys, statements: statements.length }
      })

      expect(result).toEqual({ keys: [], statements: 1 })
    })

    it("rejects an applied migration that the history lacks, since it cannot roll it back", async () => {
      await testTransaction(async () => {
        await migrate(
          db,
          defineTestHistory({ "0001_create_form": createForm, "0002_create_user": createUser }),
        )
        await expect(
          rollback(db, defineTestHistory({ "0001_create_form": createForm })),
        ).rejects.toThrow(
          'Cannot roll back the migrations of schema "migrations_tenant": migration 0002_create_user is applied, but the history lacks it',
        )
      })
    })

    it("rejects a count that is not a positive integer, or all for rollback", async () => {
      const history = defineTestHistory({ "0001_create_form": createForm })

      await expect(rollback(db, history, { count: 0 })).rejects.toThrow(
        'count must be a positive integer or "all", not 0',
      )
      await expect(redo(db, history, { count: 0 })).rejects.toThrow(
        "count must be a positive integer, not 0",
      )
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
        status: { applied: ["0001_create_form", "0002_create_user"], pending: [], unknown: [] },
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
      const history = defineTestHistory({
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
        status: { applied: ["0001_create_form"], pending: [], unknown: [] },
        forms: [{ id: 1 }],
      })
    })
  })
})

describePooledPostgres("at once", ({ database }) => {
  const db = database.bind(schema)
  const target = { schemaName: "migrations_pool_1" }

  /** Operations that a scenario started, and the gate that holds the migrations that wait for it. */
  interface Scenario {
    readonly gate: Promise<void>
    openGate(): void
    /** Registers an operation, such as `migrate`, which the scenario waits for before dropping the schemas. */
    start<T>(operation: Promise<T>): Promise<T>
  }

  /** Runs `scenario`, then opens its gate, waits for the operations it started, and drops the schemas that they committed. */
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
        DROP SCHEMA IF EXISTS migrations_pool_1, migrations_pool_2 CASCADE;
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

  it("applies each migration once when processes migrate a target at once", async () => {
    const runs = { count: 0 }

    await runScenario(async ({ gate, openGate, start }) => {
      const history = defineTestHistory({
        "0001_create_form": { up: waitBefore(createForm.up, gate, runs) },
      })
      const first = start(migrate(db, history, target))
      await waitFor(async () => runs.count === 1)
      const second = start(migrate(db, history, target))
      await waitFor(async () => (await countLockWaiters(database, "migrations_pool_1")) === 1)
      openGate()

      expect([await first, await second]).toEqual([["0001_create_form"], []])
    })

    expect(runs.count).toBe(1)
  })

  // rake-db 2.37.48 locked every target with one key, so a migration of one target blocked all others: https://github.com/romeerez/orchid-orm/issues/771
  it("migrates different targets at once", async () => {
    const runs = { count: 0 }

    await runScenario(async ({ gate, openGate, start }) => {
      const history = defineTestHistory({
        "0001_create_form": { up: waitBefore(createForm.up, gate, runs) },
      })
      const first = start(migrate(db, history, target))
      await waitFor(async () => runs.count === 1)
      const second = await settleWithin(
        start(
          migrate(db, defineTestHistory({ "0001_create_form": createForm }), {
            schemaName: "migrations_pool_2",
          }),
        ),
      )
      openGate()

      expect([await first, second]).toEqual([["0001_create_form"], ["0001_create_form"]])
    })
  })

  it("rolls back each migration once when processes roll back a target at once", async () => {
    const runs = { count: 0 }

    await runScenario(async ({ gate, openGate, start }) => {
      const history = defineTestHistory({
        "0001_create_form": createForm,
        "0002_create_user": { up: createUser.up, down: waitBefore(createUser.down, gate, runs) },
      })
      await migrate(db, history, target)
      const first = start(rollback(db, history, target))
      await waitFor(async () => runs.count === 1)
      const second = start(rollback(db, history, target))
      await waitFor(async () => (await countLockWaiters(database, "migrations_pool_1")) === 1)
      openGate()

      expect([await first, await second]).toEqual([["0002_create_user"], ["0001_create_form"]])
    })

    expect(runs.count).toBe(1)
  })
})

/** Defines a history of migrations given as values, as modules that export them would. */
function defineTestHistory(
  migrations: Record<string, Migration>,
  options?: MigrationHistoryOptions,
) {
  const loaders: Record<string, MigrationLoader> = {}
  for (const [key, migration] of Object.entries(migrations)) {
    loaders[key] = async () => ({ default: migration })
  }
  return defineMigrations(loaders, options)
}

/** Lists the tables of PostgreSQL schema `schemaName` by name. */
async function listTables(database: Database, schemaName: string): Promise<string[]> {
  return await database.query`
    SELECT table_name FROM information_schema.tables WHERE table_schema = ${schemaName} ORDER BY table_name
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

/** Counts the transactions that wait for the lock of the target in PostgreSQL schema `schemaName`. */
async function countLockWaiters(database: Database, schemaName: string): Promise<number> {
  // PostgreSQL shows a lock of a bigint key as its high and low halves.
  return await database.query`
    SELECT count(*)::integer FROM pg_locks, (SELECT hashtextextended(${`"${schemaName}"."kern_migration"`}, 0) AS key) AS lock
    WHERE locktype = 'advisory' AND NOT granted
      AND database = (SELECT oid FROM pg_database WHERE datname = current_database())
      AND classid = ((lock.key >> 32) & 4294967295)::oid AND objid = (lock.key & 4294967295)::oid
  `.get(t.integer)
}

/** Time that a test waits for a concurrent operation, shorter than the timeout of a test, so that the test cleans up after a failure. */
const waitTimeout = 2000

/** Waits until `condition` holds, checking it every 10 milliseconds, and rejects when it does not hold in time. */
async function waitFor(condition: () => Promise<boolean>): Promise<void> {
  const deadline = Date.now() + waitTimeout
  while (!(await condition())) {
    if (Date.now() > deadline) {
      throw new Error("The condition did not hold in time")
    }
    await new Promise(resolve => setTimeout(resolve, 10))
  }
}

/** Resolves to the result of `operation`, and rejects when it does not settle in time. */
async function settleWithin<T>(operation: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("The operation did not settle in time")), waitTimeout)
  })
  try {
    return await Promise.race([operation, timeout])
  } finally {
    clearTimeout(timer)
  }
}
