// Tests of the contract of `Driver` in PostgreSQL, which take the functions of a test runner and assert with `node:assert/strict`, so that any supported runner can run them.
import assert from "node:assert/strict"

import * as t from "../db/types"

import type { AnyCodec } from "./codec/codec"
import { createDatabase, getCoordinator } from "./database"
import type { Connection, Driver, TextValue } from "./driver"
import { createStatement } from "./driver"
import { ConnectionError, QueryError } from "./driver-error"
import type { SqlFragment } from "./sql/fragment"
import { identifier, param, sql } from "./sql/fragment"
import type { TestHooks } from "./testing"
import { createTestHelpers } from "./testing"
import { TransactionConnectionError } from "./transaction/connection-loss"

/** Options of `describeDriverContract`: how to create the driver under test. */
export interface DriverContractOptions {
  /** Creates a driver over a new client of the test database with `max` connections. */
  createDriver(options: { max: number }): Driver
  /** Creates a driver over a new client of the test database whose parsers of result values throw; for a client without parsers, the same as `createDriver`. */
  createDriverWithFailingParsers(): Driver
}

/**
 * Functions of a test runner that declare the tests of `describeDriverContract`.
 *
 * They are `describe`, `it`, `before`, and `after` of `node:test`, and `describe`, `it`, `beforeAll`, and `afterAll` of `bun:test` and Vitest.
 */
export interface DriverContractRunner extends TestHooks {
  describe(name: string, body: () => void): unknown
  it(name: string, test: () => Promise<void>): unknown
}

/** Creates helpers that run raw statements on `target`: a database, a driver, or a reserved connection. */
function createStatementRunners(target: Pick<Connection, "execute">) {
  return {
    async runStatement(text: string) {
      await target.execute(createStatement(text))
    },
    async selectValue(text: string, parameters: readonly TextValue[] = []) {
      const { rows } = await target.execute(createStatement(text, parameters))
      return rows[0]![0]
    },
  }
}

/** Creates the condition that each column named by a key of `codecs` equals the value of the key in `values`, as a parameter of its codec. */
function equalsEach(
  codecs: Readonly<Record<string, AnyCodec>>,
  values: Readonly<Record<string, unknown>>,
): SqlFragment {
  let condition = sql`TRUE`
  for (const key of Object.keys(codecs)) {
    condition = sql`${condition} AND ${identifier(key)} = ${param(codecs[key]!, values[key])}`
  }
  return condition
}

/**
 * Declares the tests of the contract of `Driver` for a driver.
 *
 * They run in the empty database of its clients and leave it unchanged.
 */
export function describeDriverContract(
  options: DriverContractOptions,
  runner: DriverContractRunner,
): void {
  const { createDriver, createDriverWithFailingParsers } = options
  const { describe, it, before, after } = runner

  describe("driver contract", () => {
    // Two connections let a statement on the pool run beside a transaction, and concurrent transactions wait for each other.
    const driver = createDriver({ max: 2 })
    const database = createDatabase({ driver })
    after(() => database.close())
    const { runStatement, selectValue } = createStatementRunners(database)
    const { selectValue: selectValueOnDriver } = createStatementRunners(driver)

    it("executes a query in a transaction", async () => {
      const rows = await database.transaction(async () => {
        await runStatement("CREATE TEMP TABLE pg_tag_test (id integer, label text) ON COMMIT DROP")
        await runStatement("INSERT INTO pg_tag_test VALUES (1, 'first'), (2, 'second')")
        return await database.query`SELECT label FROM pg_tag_test WHERE id = ${2}`.select({
          label: t.text,
        })
      })

      assert.deepEqual(rows, [{ label: "second" }])
    })

    it("executes a script of several statements on the connection of a transaction", async () => {
      const labels = await database.transaction(async () => {
        await database.script(`
        CREATE TEMP TABLE pg_script_test (label text) ON COMMIT DROP;
        INSERT INTO pg_script_test VALUES ('first'), ('second');
      `)
        return await selectValue("SELECT string_agg(label, ',' ORDER BY label) FROM pg_script_test")
      })

      assert.equal(labels, "first,second")
    })

    it("rejects a text of several statements without parameters before running any", async () => {
      try {
        await assert.rejects(
          database.execute(
            createStatement("CREATE TABLE pg_statement_test (id integer); SELECT 1"),
          ),
          /cannot insert multiple commands into a prepared statement/,
        )

        assert.equal(await selectValue("SELECT to_regclass('pg_statement_test')::text"), null)
      } finally {
        await database.script(
          "SET LOCAL client_min_messages = warning; DROP TABLE IF EXISTS pg_statement_test",
        )
      }
    })

    it("returns every value as text", async () => {
      const { rows } = await driver.execute(
        createStatement(
          `SELECT 42::integer, 12345678901234::bigint, true, '{"a":1}'::jsonb, NULL::text, ARRAY['a', 'b'], '2030-01-01 12:00'::timestamp`,
        ),
      )

      assert.deepEqual(rows, [
        ["42", "12345678901234", "t", '{"a": 1}', null, "{a,b}", "2030-01-01 12:00:00"],
      ])
    })

    it("keeps the values of a statement as text without the parsers of the client", async () => {
      const parsed = createDatabase({ driver: createDriverWithFailingParsers() })

      try {
        const { rows } = await parsed.execute(createStatement("SELECT 1"))

        assert.deepEqual(rows, [["1"]])
      } finally {
        await parsed.close()
      }
    })

    it("executes a script without the parsers of the client", async () => {
      const parsed = createDatabase({ driver: createDriverWithFailingParsers() })

      try {
        await parsed.script("SELECT 1; SELECT 2")
      } finally {
        await parsed.close()
      }
    })

    it("executes a script on the pool in one implicit transaction", async () => {
      try {
        await assert.rejects(
          database.script("CREATE TABLE pg_script_pool_test (id integer); SELECT 1/0"),
          (error: unknown) => error instanceof QueryError && error.code === "22012",
        )

        assert.equal(await selectValue("SELECT to_regclass('pg_script_pool_test')::text"), null)
      } finally {
        await database.script(
          "SET LOCAL client_min_messages = warning; DROP TABLE IF EXISTS pg_script_pool_test",
        )
      }
    })

    it("reports the number of rows of the command tag", async () => {
      const counts = await database.transaction(async () => {
        const created = await database.execute(
          createStatement("CREATE TEMP TABLE pg_count_test (id integer) ON COMMIT DROP"),
        )
        const inserted = await database.execute(
          createStatement("INSERT INTO pg_count_test VALUES (1), (2), (3)"),
        )
        const updated = await database.execute(
          createStatement("UPDATE pg_count_test SET id = id + 1 WHERE id > 1"),
        )
        return [created.count, inserted.count, updated.count]
      })

      assert.deepEqual(counts, [0, 3, 2])
    })

    it("reports the names of the result columns, also without rows", async () => {
      const { created, selected } = await database.transaction(async () => ({
        created: await database.execute(
          createStatement(
            "CREATE TEMP TABLE pg_columns_test (id integer, label text) ON COMMIT DROP",
          ),
        ),
        selected: await database.execute(createStatement("SELECT id, label FROM pg_columns_test")),
      }))

      assert.deepEqual(created.columns, [])
      assert.deepEqual(selected.columns, ["id", "label"])
      assert.deepEqual(selected.rows, [])
    })

    it("reports no command for a statement without a command tag", async () => {
      for (const text of ["", "-- only a comment"]) {
        const { command, count, columns, rows } = await database.execute(createStatement(text))

        assert.equal(command, null)
        assert.equal(count, 0)
        assert.deepEqual(columns, [])
        assert.deepEqual(rows, [])
      }
    })

    it("infers the types of parameters from the statement", async () => {
      assert.equal(await selectValue("SELECT $1::integer + $2", ["1", "2"]), "3")
      assert.equal(await selectValue("SELECT $1", ["text"]), "text")
      assert.equal(await selectValue("SELECT $1::text IS NULL", [null]), "t")
    })

    it("sends a parameter as it is, whatever type PostgreSQL describes for it", async () => {
      // A client that serializes a parameter by the type that PostgreSQL describes, such as postgres.js, would turn "true" into false and encode a JSON text again.
      assert.equal(await selectValueOnDriver("SELECT $1::boolean", ["true"]), "t")
      assert.equal(await selectValueOnDriver("SELECT $1::jsonb ->> 'a'", ['{"a":"x"}']), "x")
    })

    it("compares parameters of param with the operators of their types", async () => {
      const comparisons = await Promise.all([
        // Compared as text, "2" is greater than "10".
        database.query`SELECT ${param(t.integer, 2)} < ${10}`.get(t.boolean),
        // Cast to numeric(3,1), 1.04 would round to 1.0.
        database.query`SELECT ${param(t.numeric.with(3, 1), "1.04")} <> ${"1.0"}`.get(t.boolean),
        // Cast to char, "ab" would truncate to "a".
        database.query`SELECT ${param(t.char, "ab")} = ${"ab"}`.get(t.boolean),
      ])

      assert.deepEqual(comparisons, [true, true, true])
    })

    it("runs concurrent statements of a transaction in the order of calls", async () => {
      const values = await database.transaction(() =>
        Promise.all([
          selectValue("SELECT set_config('kern.test', '1', true) FROM pg_sleep(0.05)"),
          selectValue("SELECT current_setting('kern.test')"),
          selectValue("SELECT set_config('kern.test', '2', true)"),
          selectValue("SELECT current_setting('kern.test')"),
        ]),
      )

      assert.deepEqual(values, ["1", "1", "2", "2"])
    })

    it("runs the statements sent on a reserved connection before ROLLBACK inside its transaction", async () => {
      // The temporary table outlives the rollback, and closing a driver of its own drops it with the connection.
      const own = createDriver({ max: 1 })
      try {
        const connection = await own.acquire()
        const { runStatement, selectValue } = createStatementRunners(connection)
        try {
          await runStatement("CREATE TEMP TABLE pg_order_test (id integer)")
          await runStatement("BEGIN")
          await Promise.all([
            runStatement("INSERT INTO pg_order_test VALUES (1)"),
            runStatement("SELECT pg_sleep(0.05)"),
            runStatement("INSERT INTO pg_order_test VALUES (2)"),
            runStatement("ROLLBACK"),
          ])

          assert.equal(await selectValue("SELECT count(*) FROM pg_order_test"), "0")
        } finally {
          await connection.release()
        }
      } finally {
        await own.close()
      }
    })

    it("decodes the values of selected expressions with their codecs", async () => {
      const rows = await database.transaction(async () => {
        await runStatement("CREATE TEMP TABLE pg_tag_test (id integer, label text) ON COMMIT DROP")
        await runStatement("INSERT INTO pg_tag_test VALUES (1, 'first'), (2, NULL)")
        return await database.query`
          SELECT id AS key, label AS name, label = ${"first"} AS "isFirst", count(*) OVER () AS total, length(label) AS length
          FROM pg_tag_test
        `.select({
          key: t.integer,
          name: t.text.nullable(),
          isFirst: t.boolean.nullable(),
          total: t.bigint,
          length: t.integer.nullable(),
        })
      })

      // The query has no order, so the rows are sorted here.
      assert.deepEqual(
        rows.toSorted((a, b) => a.key - b.key),
        [
          { key: 1, name: "first", isFirst: true, total: 2n, length: 5 },
          { key: 2, name: null, isFirst: null, total: 2n, length: null },
        ],
      )
    })

    it("rejects a statement that PostgreSQL rejected with QueryError and keeps its connection, on the pool and on a reserved connection", async () => {
      // One connection makes every statement run on the same connection while it stays open, and closing the driver drops its temporary table.
      const own = createDriver({ max: 1 })
      try {
        const pool = createStatementRunners(own)
        await pool.runStatement(
          "CREATE TEMP TABLE pg_unique_test (id integer CONSTRAINT pg_unique_test_key UNIQUE)",
        )
        await pool.runStatement("INSERT INTO pg_unique_test VALUES (1)")
        const pid = await pool.selectValue("SELECT pg_backend_pid()")

        /** Asserts that inserting a duplicate on `target` rejects with the violated constraint, and that its connection stays the same. */
        async function assertRejected(target: Pick<Connection, "execute">) {
          const runners = createStatementRunners(target)
          const error = await runners
            .runStatement("INSERT INTO pg_unique_test VALUES (1)")
            .catch((error: unknown) => error)
          assert.ok(error instanceof QueryError, `Expected QueryError, got ${String(error)}`)
          assert.equal(error.code, "23505")
          assert.equal(error.constraint, "pg_unique_test_key")
          assert.equal(await runners.selectValue("SELECT pg_backend_pid()"), pid)
        }

        await assertRejected(own)
        const connection = await own.acquire()
        try {
          await assertRejected(connection)
        } finally {
          await connection.release()
        }
      } finally {
        await own.close()
      }
    })

    it("rejects a transaction whose failed statement the callback caught", async () => {
      const transaction = database.transaction(async () => {
        await runStatement("SELECT 1/0").catch(() => {})
        return "done"
      })

      await assert.rejects(transaction, /Transaction was rolled back/)
    })

    it("releases a clean connection after a failed commit", async () => {
      // One pooled connection makes the next statement run on the connection of the failed transaction.
      const single = createDatabase({ driver: createDriver({ max: 1 }) })
      try {
        const transaction = single.transaction(async () => {
          await single.execute(
            createStatement(
              "CREATE TEMP TABLE pg_commit_test (id integer UNIQUE DEFERRABLE INITIALLY DEFERRED) ON COMMIT DROP",
            ),
          )
          await single.execute(createStatement("INSERT INTO pg_commit_test VALUES (1), (1)"))
        })
        await assert.rejects(transaction, /duplicate key/)

        await assert.rejects(
          single.execute(createStatement("SAVEPOINT probe")),
          /transaction blocks/,
        )
      } finally {
        await single.close()
      }
    })

    it("returns a connection to the pool after PostgreSQL rejected its last statement outside a transaction", async () => {
      // One pooled connection makes the next statement run on the released connection unless the driver closed it.
      const own = createDriver({ max: 1 })
      try {
        const connection = await own.acquire()
        let pid: TextValue | undefined
        try {
          pid = await createStatementRunners(connection).selectValue("SELECT pg_backend_pid()")
          await assert.rejects(connection.execute(createStatement("SELECT 1/0")), QueryError)
        } finally {
          await connection.release()
        }

        assert.equal(await createStatementRunners(own).selectValue("SELECT pg_backend_pid()"), pid)
      } finally {
        await own.close()
      }
    })

    for (const [state, text] of [
      ["an open", "SELECT 1"],
      ["a failed", "SELECT 1/0"],
    ] as const) {
      it(`does not return a connection in ${state} transaction to the pool`, async () => {
        // One pooled connection makes the next statement run on the connection that follows the released one.
        const own = createDriver({ max: 1 })
        try {
          const connection = await own.acquire()
          try {
            await connection.execute(createStatement("BEGIN"))
            await connection.execute(createStatement(text)).catch(() => {})
          } finally {
            await connection.release()
          }

          await assert.rejects(
            own.execute(createStatement("SAVEPOINT probe")),
            /transaction blocks/,
          )
        } finally {
          await own.close()
        }
      })
    }

    describe("a statement on the pool that leaves a transaction open", () => {
      const cases: readonly (readonly [
        string,
        (own: Driver) => Promise<unknown>,
        new (...args: never) => Error,
      ])[] = [
        ["a statement", own => own.execute(createStatement("BEGIN")), ConnectionError],
        ["a script", own => own.executeScript("BEGIN; SELECT 1"), ConnectionError],
        // The failed statement leaves the transaction block open and aborted; the driver rejects with its QueryError or with ConnectionError.
        [
          "a script that fails in the transaction",
          own => own.executeScript("BEGIN; SELECT 1/0"),
          Error,
        ],
      ]
      for (const [name, run, rejection] of cases) {
        it(`rejects ${name} and leaves no transaction on the pool`, async () => {
          // postgres.js runs the pool of a client with one connection as one session, so the client has two connections.
          const own = createDriver({ max: 2 })
          const held: Connection[] = []
          try {
            await assert.rejects(run(own), rejection)

            // Reserving every connection checks each one that the pool kept, whichever ran the statement.
            for (let count = 0; count < 2; count++) {
              held.push(await own.acquire())
            }
            for (const connection of held) {
              await assert.rejects(
                connection.execute(createStatement("SAVEPOINT probe")),
                /transaction blocks/,
              )
            }
          } finally {
            // Closing waits for the reserved connections, so a failure before their release would hang it.
            await Promise.allSettled(held.map(async connection => connection.release()))
            await own.close()
          }
        })
      }
    })

    it("rejects a transaction whose connection is lost and keeps the pool usable", async () => {
      // One pooled connection makes the next transaction run on the connection that replaces the lost one.
      const single = createDatabase({ driver: createDriver({ max: 1 }) })
      const { selectValue: selectValueOnSingle } = createStatementRunners(single)
      try {
        const transaction = single.transaction(async () => {
          const pid = await selectValueOnSingle("SELECT pg_backend_pid()")
          await selectValue("SELECT pg_terminate_backend($1)", [pid!])
          await selectValueOnSingle("SELECT 1")
        })
        await assert.rejects(
          transaction,
          (error: unknown) =>
            error instanceof TransactionConnectionError && error.phase === "transaction",
        )

        assert.equal(
          await single.transaction(() => selectValueOnSingle("SELECT 'usable'")),
          "usable",
        )
      } finally {
        await single.close()
      }
    })

    it("rejects a statement of a transaction whose connection is lost with ConnectionError", async () => {
      const own = createDriver({ max: 1 })
      try {
        const connection = await own.acquire()
        const { runStatement, selectValue: selectValueOnConnection } =
          createStatementRunners(connection)
        try {
          await runStatement("BEGIN")
          await runStatement("CREATE TEMP TABLE pg_lost_test (id integer) ON COMMIT DROP")
          const pid = (await selectValueOnConnection("SELECT pg_backend_pid()"))!
          // The timeout makes it wait for the backend to exit.
          assert.equal(await selectValue("SELECT pg_terminate_backend($1, 5000)", [pid]), "t")
          // The client reads that the connection closed before the next statement, as a client that reconnects would before sending it on a new connection.
          await new Promise(resolve => setTimeout(resolve, 50))

          // On a new connection, the statement would reject with QueryError, since the table belonged to the lost transaction.
          const error = await runStatement("INSERT INTO pg_lost_test VALUES (1)").catch(
            (error: unknown) => error,
          )
          assert.ok(
            error instanceof ConnectionError,
            `Expected ConnectionError, got ${String(error)}`,
          )
        } finally {
          await connection.release()
        }
      } finally {
        await own.close()
      }
    })

    it("rejects a statement of a reserved connection that is lost outside a transaction with ConnectionError", async () => {
      const own = createDriver({ max: 1 })
      try {
        const connection = await own.acquire()
        const { runStatement, selectValue: selectValueOnConnection } =
          createStatementRunners(connection)
        try {
          await runStatement("SELECT set_config('application_name', 'kern_lost_test', false)")
          const pid = (await selectValueOnConnection("SELECT pg_backend_pid()"))!
          // The timeout makes it wait for the backend to exit.
          assert.equal(await selectValue("SELECT pg_terminate_backend($1, 5000)", [pid]), "t")
          // The client reads that the connection closed before the next statement, as a client that reconnects would before sending it on a new connection.
          await new Promise(resolve => setTimeout(resolve, 50))

          // On a new connection, a statement would resolve without the setting of the lost session; a driver must reject every later one, not only the first, which tells it that the connection closed.
          const readSetting = "SELECT current_setting('application_name')"
          const errors = [
            await runStatement(readSetting).catch((error: unknown) => error),
            await runStatement(readSetting).catch((error: unknown) => error),
            await connection.executeScript(readSetting).catch((error: unknown) => error),
          ]
          for (const error of errors) {
            assert.ok(
              error instanceof ConnectionError,
              `Expected ConnectionError, got ${String(error)}`,
            )
          }
        } finally {
          await connection.release()
        }
      } finally {
        await own.close()
      }
    })

    it("replaces an idle connection whose backend exited", async () => {
      const own = createDriver({ max: 2 })
      const held: Connection[] = []
      try {
        // Reserving every connection opens the whole pool, so terminating their backends leaves no existing connection usable.
        for (let count = 0; count < 2; count++) {
          held.push(await own.acquire())
        }
        const pids: TextValue[] = []
        for (const connection of held) {
          pids.push(
            (await createStatementRunners(connection).selectValue("SELECT pg_backend_pid()"))!,
          )
        }
        // Each connection leaves `held` before its release, so that a failed release leaves the others to `finally`.
        while (held.length > 0) {
          await held.shift()!.release()
        }
        for (const pid of pids) {
          // The timeout makes it wait for the backend to exit.
          assert.equal(await selectValue("SELECT pg_terminate_backend($1, 5000)", [pid]), "t")
        }
        // The client learns that a connection closed only once it reads its socket, which may come after the result of the termination.
        await new Promise(resolve => setTimeout(resolve, 50))

        assert.equal(await createStatementRunners(own).selectValue("SELECT 'usable'"), "usable")
      } finally {
        // Closing waits for the reserved connections, so a failure before their release would hang it; the test already fails with that failure.
        await Promise.allSettled(held.map(async connection => connection.release()))
        await own.close()
      }
    })

    // Transaction-local settings and backend PIDs observe routing without committed tables.
    it("isolates concurrent transactions on their own connections", async () => {
      const bothStarted = Promise.withResolvers<void>()
      let startedCount = 0

      function runTransaction(label: string) {
        return database.transaction(async () => {
          const startPid = await selectValue("SELECT pg_backend_pid()")
          await selectValue("SELECT set_config('kern.test', $1, true)", [label])
          startedCount += 1
          if (startedCount === 2) {
            bothStarted.resolve()
          }
          await bothStarted.promise
          return {
            startPid,
            endPid: await selectValue("SELECT pg_backend_pid()"),
            label: await selectValue("SELECT current_setting('kern.test')"),
          }
        })
      }

      const [result1, result2] = await Promise.all([runTransaction("1"), runTransaction("2")])

      assert.equal(result1.endPid, result1.startPid)
      assert.equal(result2.endPid, result2.startPid)
      assert.notEqual(result1.startPid, result2.startPid)
      assert.deepEqual([result1.label, result2.label], ["1", "2"])
    })

    it("runs queries outside an open transaction on the pool", async () => {
      const transactionStarted = Promise.withResolvers<void>()
      const outsideFinished = Promise.withResolvers<void>()

      const transactionPid = database.transaction(async () => {
        await selectValue("SELECT set_config('kern.test', 'inside', true)")
        transactionStarted.resolve()
        await outsideFinished.promise
        return selectValue("SELECT pg_backend_pid()")
      })
      await transactionStarted.promise
      const outsidePid = await selectValue("SELECT pg_backend_pid()")
      const outsideLabel = await selectValue("SELECT current_setting('kern.test', true)")
      outsideFinished.resolve()

      assert.notEqual(outsidePid, await transactionPid)
      assert.notEqual(outsideLabel, "inside")
    })

    describe("closing", () => {
      /** Creates a database whose client has one connection, so that a transaction waits for the connection of another one. */
      function createClosableDatabase() {
        return createDatabase({ driver: createDriver({ max: 1 }) })
      }

      it("waits for a running transaction and for a transaction waiting for a connection", async () => {
        const database = createClosableDatabase()
        const { promise: started, resolve: start } = Promise.withResolvers<void>()
        const { promise: closeRequested, resolve: requestClose } = Promise.withResolvers<void>()
        const { selectValue } = createStatementRunners(database)

        const running = database.transaction(async () => {
          start()
          await closeRequested
          return selectValue("SELECT 'running'")
        })
        await started
        const waiting = database.transaction(() => selectValue("SELECT 'waiting'"))
        const closing = database.close()
        requestClose()

        assert.equal(await running, "running")
        assert.equal(await waiting, "waiting")
        await closing
      })

      it("waits for a statement on the pool waiting for a connection", async () => {
        const database = createClosableDatabase()
        const { promise: started, resolve: start } = Promise.withResolvers<void>()
        const { promise: closeRequested, resolve: requestClose } = Promise.withResolvers<void>()
        const { selectValue } = createStatementRunners(database)

        const running = database.transaction(async () => {
          start()
          await closeRequested
        })
        await started
        const waiting = selectValue("SELECT 'waiting'")
        const closing = database.close()
        requestClose()

        await running
        assert.equal(await waiting, "waiting")
        await closing
      })

      it("waits for an in-flight pool query before closing", async () => {
        const database = createClosableDatabase()
        const { selectValue } = createStatementRunners(database)
        // An open connection runs the query at once instead of opening first.
        await selectValue("SELECT 1")
        const settled: string[] = []

        const query = selectValue("SELECT 'slept' FROM pg_sleep(0.2)")
        query.then(
          () => settled.push("query"),
          () => {},
        )
        await database.close()
        settled.push("database")

        assert.equal(await query, "slept")
        assert.deepEqual(settled, ["query", "database"])
      })

      it("rejects a statement, a script, and a connection requested right after it starts with ConnectionError", async () => {
        // The held connection of a client with one connection keeps the closing going, so a statement the driver lets through waits for it.
        const driver = createDriver({ max: 1 })
        const held = await driver.acquire()

        const closing = driver.close()
        // Requested at once: a client may still run a statement sent before it starts closing its pool.
        const acquiring = driver.acquire()
        const rejections = [
          assert.rejects(driver.execute(createStatement("SELECT 1")), ConnectionError),
          assert.rejects(driver.executeScript("SELECT 1"), ConnectionError),
          assert.rejects(acquiring, ConnectionError),
        ]
        // A connection handed out by mistake is released, so that closing ends and the test fails instead of hanging.
        acquiring.then(connection => connection.release()).catch(() => {})
        // Released before awaiting the rejections, so that a statement waiting for the connection runs and fails the test instead of hanging it.
        await held.release()

        try {
          await Promise.all(rejections)
        } finally {
          await closing
        }
      })
    })

    // Tests that create tables and data run in test transactions, which leave the database unchanged.
    describe("in test transactions", () => {
      const database = createDatabase({
        driver: createDriver({ max: 2 }),
        test: true,
      })
      after(() => database.close())
      const { testTransaction } = createTestHelpers(database, { before, after })
      const { runStatement, selectValue } = createStatementRunners(database)

      it("discards only the rows of a rolled-back nested transaction", async () => {
        const ids = await testTransaction(async () => {
          await runStatement("CREATE TABLE pg_nested_test (id integer)")
          await runStatement("INSERT INTO pg_nested_test VALUES (1)")
          const failure = new Error("failure")
          const failed = database.transaction(async () => {
            await runStatement("INSERT INTO pg_nested_test VALUES (2)")
            throw failure
          })
          await assert.rejects(failed, error => error === failure)
          await database.transaction(() => runStatement("INSERT INTO pg_nested_test VALUES (3)"))
          return await database.query`SELECT id FROM pg_nested_test`.pluck(t.integer)
        })

        assert.deepEqual(ids.toSorted(), [1, 3])
      })

      it("keeps the transaction usable after a failed statement in a nested transaction", async () => {
        const value = await testTransaction(async () => {
          await assert.rejects(
            database.transaction(() => runStatement("SELECT 1/0")),
            /division by zero/,
          )
          return await selectValue("SELECT 'usable'")
        })

        assert.equal(value, "usable")
      })

      it("keeps the changes of open fixtures for test transactions until each fixture closes", async () => {
        const queryLabels = async () =>
          (await database.query`SELECT label FROM pg_fixture_test`.pluck(t.text)).toSorted()
        const selectLabels = () => testTransaction(queryLabels)

        {
          await using _run = await getCoordinator(database).createTestFixture(async () => {
            await runStatement("CREATE TABLE pg_fixture_test (label text)")
            await runStatement("INSERT INTO pg_fixture_test VALUES ('run')")
          })
          {
            await using file = await getCoordinator(database).createTestFixture(async () => {
              await runStatement("INSERT INTO pg_fixture_test VALUES ('file')")
              return await database.query`SELECT label FROM pg_fixture_test WHERE label = ${"file"}`.select(
                { label: t.text },
              )
            })
            assert.deepEqual(file.data, [{ label: "file" }])

            const inTest = await testTransaction(async () => {
              await runStatement("INSERT INTO pg_fixture_test VALUES ('test')")
              return await queryLabels()
            })
            assert.deepEqual(inTest, ["file", "run", "test"])
            assert.deepEqual(await selectLabels(), ["file", "run"])
          }
          assert.deepEqual(await selectLabels(), ["run"])
        }

        assert.equal(
          await testTransaction(() => selectValue("SELECT to_regclass('pg_fixture_test')")),
          null,
        )
      })

      // A client can wait for its reserved connections when it ends, so ending it under an open fixture would wait forever.
      it("closes a database with an open fixture", async () => {
        const closed = createDatabase({
          driver: createDriver({ max: 1 }),
          test: true,
        })
        const fixture = await getCoordinator(closed).createTestFixture(() =>
          closed.execute(createStatement("SELECT 1")),
        )

        await closed.close()

        assert.throws(() => fixture.data, /Test fixture is closed/)
      })

      it("round-trips the built-in types", async () => {
        const codecs = {
          bigint: t.bigint,
          numeric: t.numeric.with(20, 6),
          price: t.numeric.with(10, 2).transform({ decode: Number }),
          double: t.doublePrecision,
          flag: t.boolean,
          id: t.uuid,
          bytes: t.bytea,
          at: t.timestamptz,
          local: t.timestamp,
          day: t.date,
          clock: t.time,
          span: t.interval,
          doc: t.jsonb.of<{ tags: string[] }>(),
          labels: t.array(t.text.nullable()),
          address: t.inet,
          status: t.enum("pg_status_test", ["draft", "published"]),
        }
        const values = {
          bigint: 9007199254740993n,
          numeric: "12345678901234.123456",
          price: 12.5,
          double: 0.1,
          flag: true,
          id: "0193d6b6-7c43-7000-8000-000000000001",
          bytes: new Uint8Array([0, 255]),
          at: "2026-01-15T07:00:00.123456Z",
          local: "2026-01-15T10:00:00.000000",
          day: "2026-01-15",
          clock: "10:00:00.500000",
          span: "1 day 02:00:00",
          doc: { tags: ["a", "b"] },
          labels: ["a", "b c", null, "NULL"],
          address: "192.168.0.1",
          status: "published" as const,
        }

        const rows = await testTransaction(async () => {
          // A time zone far from UTC checks that timestamptz values are normalized.
          await runStatement("SET LOCAL TIME ZONE 'Asia/Bangkok'")
          await runStatement("CREATE TYPE pg_status_test AS ENUM ('draft', 'published')")
          await runStatement(`
          CREATE TABLE pg_type_test (
            bigint bigint, numeric numeric(20, 6), price numeric(10, 2), double double precision, flag boolean, id uuid,
            bytes bytea, at timestamptz, local timestamp, day date, clock time, span interval,
            doc jsonb, labels text[], address inet, status pg_status_test
          )
        `)
          await runStatement(`
          INSERT INTO pg_type_test VALUES (
            9007199254740993, 12345678901234.123456, 12.50, 0.1, true, '0193d6b6-7c43-7000-8000-000000000001',
            '\\x00ff', '2026-01-15 14:00:00.123456+07', '2026-01-15 10:00', '2026-01-15', '10:00:00.5',
            '1 day 2 hours', '{"tags": ["a", "b"]}', '{a,"b c",NULL,"NULL"}', '192.168.0.1', 'published'
          )
        `)
          const selected = await database.query`SELECT * FROM pg_type_test`.select(codecs)
          // Every value also matches itself as an encoded parameter.
          const matched =
            await database.query`SELECT id FROM pg_type_test WHERE ${equalsEach(codecs, values)}`.pluck(
              t.uuid,
            )
          return { selected, matched }
        })

        assert.deepEqual(rows.selected, [values])
        assert.deepEqual(rows.matched, [values.id])
      })

      it("round-trips date and time values of years outside 1 to 9999", async () => {
        const codecs = {
          id: t.integer,
          at: t.timestamptz,
          local: t.timestamp,
          day: t.date,
        }
        const values = [
          {
            id: 1,
            at: "0000-01-01T00:00:00.000000Z",
            local: "-000001-06-15T10:00:00.000000",
            day: "-004712-01-01",
          },
          {
            id: 2,
            at: "+294276-12-31T23:59:59.999999Z",
            local: "+010000-01-01T00:00:00.000000",
            day: "+010000-01-01",
          },
          {
            id: 3,
            at: "9999-12-31T23:59:59.000000Z",
            local: "9999-12-31T23:59:59.000000",
            day: "+5874897-12-31",
          },
        ]

        const rows = await testTransaction(async () => {
          await runStatement("SET LOCAL TIME ZONE 'Asia/Bangkok'")
          await runStatement(
            "CREATE TABLE pg_moment_test (id integer, at timestamptz, local timestamp, day date)",
          )
          await runStatement(`
          INSERT INTO pg_moment_test VALUES
            (1, '0001-01-01 00:00:00+00 BC', '0002-06-15 10:00 BC', '4713-01-01 BC'),
            (2, '294276-12-31 23:59:59.999999+00', '10000-01-01', '10000-01-01'),
            (3, '9999-12-31 23:59:59+00', '9999-12-31 23:59:59', '5874897-12-31')
        `)
          const selected = await database.query`SELECT * FROM pg_moment_test ORDER BY id`.select(
            codecs,
          )
          // Every value also matches itself as an encoded parameter.
          const matched = await Promise.all(
            values.map(value =>
              database.query`SELECT id FROM pg_moment_test WHERE ${equalsEach(codecs, value)}`.pluck(
                t.integer,
              ),
            ),
          )
          return { selected, matched }
        })

        assert.deepEqual(rows.selected, values)
        assert.deepEqual(rows.matched, [[1], [2], [3]])
      })
    })
  })
}
