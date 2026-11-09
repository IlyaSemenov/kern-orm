// Releasing a node-postgres connection whose last statement PostgreSQL rejected: waiting with an empty query for the status of its transaction and returning it to the pool, which `@kern-orm/node-postgres` does, against closing it, which makes the next statement reconnect.
// It measures the time from the release to the end of the next statement, `SELECT 1`, on a pool of one connection.

import pg from "pg"

import { runBenchmark } from "../harness"
import { findMedian } from "../statistics"

/** Number of timed releases of each variant. */
const runs = 100

await runBenchmark(async () => {
  const variants = [
    {
      name: "wait for the status",
      async release(client: pg.PoolClient) {
        await client.query({ text: "" })
        client.release(client.getTransactionStatus() !== "I")
      },
    },
    { name: "close", release: (client: pg.PoolClient) => client.release(true) },
  ]
  const times: number[] = []
  for (const { name, release } of variants) {
    const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 })
    try {
      // The first statement opens the connection.
      await pool.query("SELECT 1")
      const samples: number[] = []
      for (let run = 0; run < runs; run++) {
        const client = await pool.connect()
        await client.query("SELECT 1/0").catch(() => {})
        const start = performance.now()
        await release(client)
        await pool.query("SELECT 1")
        samples.push(performance.now() - start)
      }
      times.push(findMedian(samples))
      console.log(
        `${name.padEnd(19)}: ${times.at(-1)!.toFixed(3)} ms to the end of the next statement`,
      )
    } finally {
      await pool.end()
    }
  }
  console.log(`Closing takes ${(times[1]! / times[0]!).toFixed(1)} times longer`)
})
