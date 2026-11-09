// Database in PostgreSQL at DATABASE_URL for the runner scenarios of a test that times out, whose driver records every completed statement and release as a JSON line of the file at LOG.
import { appendFileSync } from "node:fs"

import { postgresJsDriver } from "@kern-orm/postgres-js"
import { createDatabase, createStatement } from "kern-orm"
import postgres from "postgres"

/** Records `text` as a line of the scenario. */
export function record(text) {
  appendFileSync(process.env.LOG, `${JSON.stringify({ pid: process.pid, text })}\n`)
}

const driver = postgresJsDriver(postgres(process.env.DATABASE_URL))
let acquired = 0

/** Executes a statement through `execute` and records it with its connection, `pool` or the number of an acquired connection, once it completes. */
async function executeRecorded(connection, execute, statement) {
  try {
    const result = await execute(statement)
    record(`${connection}: ${statement.text}`)
    return result
  } catch (error) {
    record(`${connection}: ${statement.text} failed: ${error.message}`)
    throw error
  }
}

export const database = createDatabase({
  driver: {
    execute: statement => executeRecorded("pool", driver.execute, statement),
    async acquire() {
      const connection = await driver.acquire()
      const id = ++acquired
      return {
        execute: statement => executeRecorded(id, connection.execute, statement),
        release() {
          record(`${id}: release`)
          return connection.release()
        },
      }
    },
    close: () => driver.close(),
  },
  test: true,
})

/** Executes a statement without parameters and returns its first value. */
export async function run(text) {
  const { rows } = await database.execute(createStatement(text))
  return rows[0]?.[0]
}

/**
 * Registers a test that passes, a test that times out while its query runs, and a test that runs after it.
 *
 * `defineTest(name, body, timeout)` registers a test that runs `body` in a test transaction with the abort signal of the test.
 */
export function defineTimeoutTests(defineTest) {
  const lateFinished = Promise.withResolvers()

  defineTest("passes", () => run("SELECT 'passes'"))

  defineTest(
    "times out",
    async () => {
      await run("SELECT set_config('kern.test', 'timed out', true)")
      // The test times out while PostgreSQL sleeps.
      await run("SELECT pg_sleep(1)")
      await run("SELECT 'late'").catch(error => record(`late: ${error.message}`))
      lateFinished.resolve()
    },
    300,
  )

  defineTest("runs after the timed-out test", async () => {
    await lateFinished.promise
    // The setting is empty after the rollback, or absent on a connection where it was never set.
    const setting = await run("SELECT current_setting('kern.test', true)")
    if (setting) {
      throw new Error(`The setting of the timed-out test remains: ${setting}`)
    }
  })
}
