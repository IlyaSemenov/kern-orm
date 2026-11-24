// Compares Bun's native result decoding, with and without named preparation, to Kern queries returning the same records through Bun SQL and postgres.js.
// The raw controls construct records with UTF-8 strings or with Kern-decoded values, with and without reserving a connection.
// Run with bun run --cwd benchmarks bench bun-sql-results against a local test database.

import assert from "node:assert/strict"

import { createDatabase, param } from "kern-db"
import { bunSqlDriver } from "kern-db/bun-sql"
import { postgresJsDriver } from "kern-db/postgres-js"
import * as t from "kern-db/types"
import postgres from "postgres"

import { findMedian } from "../statistics"

const url = process.env.DATABASE_URL
if (!url) throw new Error("Set DATABASE_URL to the test database")
await using native = new Bun.SQL(url, { max: 1 })
await using unnamed = new Bun.SQL(url, { max: 1, prepare: false })
await using bunSqlDatabase = createDatabase({
  driver: bunSqlDriver(new Bun.SQL(url, { max: 1, prepare: false })),
})
await using postgresJsDatabase = createDatabase({
  driver: postgresJsDriver(postgres(url, { max: 1 })),
})

console.log(
  `Bun ${Bun.version}, PostgreSQL ${(await native`SHOW server_version`)[0].server_version}`,
)
for (const count of [1, 100, 10_000]) {
  const text =
    "SELECT i AS id, i % 2 = 0 AS even, i::text AS label FROM generate_series(1, $1::integer) i"
  const fields = { id: t.integer, even: t.boolean, label: t.text }
  const expected = Array.from({ length: count }, (_, index) => ({
    id: index + 1,
    even: (index + 1) % 2 === 0,
    label: String(index + 1),
  }))
  const expectedText = expected.map(row => ({
    id: String(row.id),
    even: row.even ? "t" : "f",
    label: row.label,
  }))
  const selectRecords = (database: typeof bunSqlDatabase) =>
    database.query`SELECT i AS id, i % 2 = 0 AS even, i::text AS label FROM generate_series(1, ${param(t.integer, count)}) i`.select(
      fields,
    )
  async function readWithCodecs(client: Bun.SQL) {
    const rows = await client.unsafe<[Buffer, Buffer, Buffer][]>(text, [String(count)]).raw()
    const records = []
    for (const row of rows) {
      records.push({
        id: t.integer.decode(row[0].toString()),
        even: t.boolean.decode(row[1].toString()),
        label: t.text.decode(row[2].toString()),
      })
    }
    return records
  }
  const variants = [
    { name: "Bun prepared", run: () => native.unsafe(text, [String(count)]) },
    { name: "Bun unnamed", run: () => unnamed.unsafe(text, [String(count)]) },
    {
      name: "Bun raw as strings",
      expected: expectedText,
      run: async () => {
        const rows = await unnamed.unsafe<[Buffer, Buffer, Buffer][]>(text, [String(count)]).raw()
        const records = []
        for (const row of rows)
          records.push({
            id: row[0].toString(),
            even: row[1].toString(),
            label: row[2].toString(),
          })
        return records
      },
    },
    { name: "Bun raw + Kern codecs", run: () => readWithCodecs(unnamed) },
    {
      name: "Bun reserved + Kern codecs",
      run: async () => {
        const connection = await unnamed.reserve()
        try {
          return await readWithCodecs(connection)
        } finally {
          await connection.release()
        }
      },
    },
    { name: "Kern Bun SQL", run: () => selectRecords(bunSqlDatabase) },
    { name: "Kern postgres.js", run: () => selectRecords(postgresJsDatabase) },
  ].map(variant => ({ ...variant, times: [] as number[] }))
  for (const variant of variants)
    assert.deepEqual([...(await variant.run())], variant.expected ?? expected)
  // Rotate the order so one variant does not always run immediately after the same work.
  for (let round = 0; round < 90; round++) {
    for (let offset = 0; offset < variants.length; offset++) {
      const variant = variants[(round + offset) % variants.length]!
      const start = performance.now()
      await variant.run()
      if (round >= 30) variant.times.push(performance.now() - start)
    }
  }
  for (const variant of variants) {
    console.log(`${count} rows, ${variant.name}: ${findMedian(variant.times).toFixed(3)} ms`)
  }
}
