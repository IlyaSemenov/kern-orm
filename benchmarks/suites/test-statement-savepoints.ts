// A statement of a test outside a transaction in a savepoint of its own, which the levels of the test helpers run so that a failed statement undoes only itself, sent right behind its SAVEPOINT, against the statement alone.
// It measures the time of a statement, a read and a write, from its SAVEPOINT to its RELEASE, on postgres.js, which pipelines the statements, and on node-postgres, which sends each after the previous one completes.

import pg from "pg"

import type { Run } from "../harness"
import { runBenchmark } from "../harness"
import { findMedian } from "../statistics"

/** Number of timed statements of each variant. */
const runs = 2000

/** Prints the median time of a read and a write alone and in a savepoint of its own, run by `run` in a transaction with the table `bench_row`. */
async function compare(driver: string, run: Run): Promise<void> {
  const variants = [
    { name: "alone", execute: (text: string) => run(text) },
    {
      name: "savepoint",
      async execute(text: string) {
        await Promise.all([run("SAVEPOINT kern_1"), run(text)])
        await run("RELEASE SAVEPOINT kern_1")
      },
    },
  ]
  for (const [kind, text] of [
    ["read", "SELECT 1"],
    ["write", "INSERT INTO bench_row VALUES (1)"],
  ] as const) {
    const times: number[] = []
    for (const { name, execute } of variants) {
      await execute(text)
      const samples: number[] = []
      for (let index = 0; index < runs; index++) {
        const start = performance.now()
        await execute(text)
        samples.push(performance.now() - start)
      }
      times.push(findMedian(samples))
      console.log(`${driver} ${kind} ${name.padEnd(9)}: ${(times.at(-1)! * 1000).toFixed(1)} µs`)
    }
    console.log(
      `${driver} ${kind}: a savepoint takes ${(times[1]! / times[0]!).toFixed(1)} times the statement alone`,
    )
  }
}

await runBenchmark(async run => {
  await run("CREATE TEMPORARY TABLE bench_row (id integer)")
  await compare("postgres.js", run)

  const client = new pg.Client({ connectionString: process.env.DATABASE_URL })
  await client.connect()
  try {
    // A transaction of its own, which rolls back, as the transaction of runBenchmark does.
    await client.query("BEGIN")
    await client.query("CREATE TEMPORARY TABLE bench_row (id integer)")
    await compare(
      "node-postgres",
      async text => (await client.query({ text, rowMode: "array" })).rows,
    )
    await client.query("ROLLBACK")
  } finally {
    await client.end()
  }
})
