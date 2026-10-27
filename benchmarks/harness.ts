// Harness of the benchmarks: a transaction whose changes roll back, and median timings of statements and JavaScript.

import { postgresJsDriver } from "@kern-orm/postgres-js"
import type { DriverResult } from "kern-orm"
import { createDatabase, createStatement } from "kern-orm"
import postgres from "postgres"

/** Number of timed runs of a measurement, after a run that warms up caches. */
const runs = 7

/** Rows of a statement as PostgreSQL text representations of their values. */
export type Rows = DriverResult["rows"]

/** Executes SQL text without parameters in the transaction of a benchmark. */
export type Run = (text: string) => Promise<Rows>

/**
 * Runs `body` in a transaction on the database at `DATABASE_URL` that rolls back after it, so a benchmark leaves the database unchanged.
 *
 * It prints the version of PostgreSQL first, which the results depend on.
 */
export async function runBenchmark(body: (run: Run) => Promise<void>): Promise<void> {
  const url = process.env.DATABASE_URL
  if (url === undefined) {
    throw new Error("Set DATABASE_URL, such as in .env.test.local, to an empty database")
  }
  await using database = createDatabase({ driver: postgresJsDriver(postgres(url, { max: 1 })) })
  const run: Run = async text => (await database.execute(createStatement(text))).rows
  // A transaction rolls back when its callback throws, so the callback throws this error once the body completes; other errors propagate.
  const rollback = new Error("Roll back the changes of the benchmark")
  try {
    await database.transaction(async () => {
      console.log(`PostgreSQL ${(await run("SHOW server_version"))[0]![0]}`)
      await body(run)
      throw rollback
    })
  } catch (error) {
    if (error !== rollback) {
      throw error
    }
  }
}

/** Median execution time of `text` in PostgreSQL, in milliseconds, from `EXPLAIN ANALYZE`, which discards the rows of the query. */
export async function measureExecution(run: Run, text: string): Promise<number> {
  await run(text)
  const times: number[] = []
  for (let index = 0; index < runs; index++) {
    const rows = await run(`EXPLAIN (ANALYZE, TIMING OFF, FORMAT JSON) ${text}`)
    times.push(JSON.parse(rows[0]![0]!)[0]["Execution Time"])
  }
  return findMedian(times)
}

/** Median time of a round trip of `text` with its rows as text, in milliseconds, and the rows of its last run. */
export async function measureRoundTrip(
  run: Run,
  text: string,
): Promise<{ time: number; rows: Rows }> {
  let rows = await run(text)
  const times: number[] = []
  for (let index = 0; index < runs; index++) {
    const start = performance.now()
    rows = await run(text)
    times.push(performance.now() - start)
  }
  return { time: findMedian(times), rows }
}

/** Median time of `callback`, in milliseconds. */
export function measure(callback: () => unknown): number {
  callback()
  const times: number[] = []
  for (let index = 0; index < runs; index++) {
    const start = performance.now()
    callback()
    times.push(performance.now() - start)
  }
  return findMedian(times)
}

function findMedian(values: number[]): number {
  const sorted = values.toSorted((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]!
}
