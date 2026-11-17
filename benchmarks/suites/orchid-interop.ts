// End-to-end comparison of native Orchid and the Kern adapter on a disposable PostgreSQL schema.
// Build from the root with bun run build, then run bun run --cwd benchmarks bench:orchid.
// Node.js: node --env-file=.env.test.local benchmarks/suites/orchid-interop.ts.
// Add --wire for protocol counts or --timing <substring> for a subset of timing scenarios.
// Run --rss <objects|arrays>-<1000|10000|100000> <orchid|kern> in a fresh process for peak RSS.
// Set ORCHID_BENCH_PAIRS to change the number of timing pairs per scenario.

import assert from "node:assert/strict"
import { once } from "node:events"
import { connect } from "node:net"

import { createOrchidInterop } from "@kern-orm/orchid-interop"
import { createTestHelpers } from "kern-db/testing"
import { createBaseTable, testTransaction } from "orchid-orm"
import { orchidORM } from "orchid-orm/postgres-js"
import postgres from "postgres"

import { findMedian, findMedianInterval } from "../statistics.ts"

const databaseURL = process.env.DATABASE_URL
assert(databaseURL, "Set DATABASE_URL to an empty benchmark database")
const [mode = "--timing", scenarioName, rssSide] = process.argv.slice(2)
assert(["--timing", "--wire", "--rss"].includes(mode), "Unknown benchmark mode")
const pairs = Number(process.env.ORCHID_BENCH_PAIRS ?? 15)
assert(Number.isSafeInteger(pairs) && pairs >= 3, "Use at least three timing pairs")

const BaseTable = createBaseTable()
class ItemTable extends BaseTable {
  override readonly table = "items"
  override columns = this.setColumns(t => ({
    id: t.integer().primaryKey(),
    value: t.text(),
  }))
}
const tables = { item: ItemTable }
type Side = "orchid" | "kern"
const sides = ["orchid", "kern"] as const
type Body = () => Promise<void>

const schema = `orchid_bench_${process.pid}_${Date.now()}`
const setup = postgres(databaseURL, { max: 1, onnotice: false })
const exchanges = { orchid: 0, kern: 0 }
let counting = false

/** Counts the Query, Flush and Sync boundaries of sequential PostgreSQL exchanges after startup. */
function countSocket(side: Side): NonNullable<postgres.Options<{}>["socket"]> {
  return async (options, host, port) => {
    assert(
      !options.ssl || options.ssl === "disable",
      "--wire requires a local connection without TLS",
    )
    const socket = connect(options.path ? { path: options.path } : { host, port })
    await once(socket, "connect")
    socket.setNoDelay(true)
    const write = socket.write
    socket.write = function (chunk: Buffer, ...args: unknown[]) {
      if (counting) {
        for (let offset = 0; offset < chunk.length;) {
          const type = chunk[offset]
          // Q is a simple query, H requests a description before bind, and S closes an extended exchange.
          if (type === 0x51 || type === 0x48 || type === 0x53) exchanges[side]++
          offset += 1 + chunk.readUInt32BE(offset + 1)
        }
      }
      return Reflect.apply(write, socket, [chunk, ...args]) as boolean
    } as typeof socket.write
    // The client calls end() or end(buffer), both supported by Node's overloaded method.
    return socket as unknown as Awaited<ReturnType<NonNullable<postgres.Options<{}>["socket"]>>>
  }
}

function connection(side: Side) {
  return {
    databaseURL,
    max: 1,
    max_lifetime: 0,
    connection: { search_path: schema },
    ...(mode === "--wire" ? { socket: countSocket(side) } : {}),
  }
}

async function createClients(side: Side, test: boolean) {
  if (side === "orchid") {
    const db = orchidORM(connection(side), tables)
    return {
      db,
      close: () => db.$close(),
      test: async (body: Body) => {
        await testTransaction.start(db)
        try {
          await body()
        } finally {
          await testTransaction.rollback(db)
        }
      },
    }
  }
  const { database, orchid: db } = await createOrchidInterop(
    { connection: connection(side), database: { test } },
    tables,
  )
  const helpers = test ? createTestHelpers(database, { before() {}, after() {} }) : undefined
  return { db, close: () => database.close(), test: helpers?.testTransaction }
}

type Clients = Awaited<ReturnType<typeof createClients>>
type Db = Clients["db"]

/** Reads eight types through the same raw SQL API for both result modes. */
async function readRows(db: Db, arrays: boolean, size: number) {
  // The sizes are benchmark constants. Literal limits also give both sides one exchange.
  const query = BaseTable.sql({
    raw: `
    SELECT id, big, label, amount, stamp, payload, mood, optional FROM mixed ORDER BY id LIMIT ${size}
  `,
  })
  const result = arrays ? await db.$queryArrays(query) : await db.$query(query)
  assert.equal(result.rows.length, size)
  return result
}

interface Scenario {
  name: string
  units: number
  batch: number
  test?: true
  run(clients: Clients): Promise<unknown>
}

const scenarios: Scenario[] = []
for (const query of ["select", "update"] as const) {
  for (const transaction of [false, true]) {
    scenarios.push({
      name: `${query}-${transaction ? "transaction" : "pool"}`,
      units: 1_000,
      batch: 1,
      async run({ db }) {
        const body = async () => {
          for (let index = 0; index < 1_000; index++) {
            if (query === "select") assert.equal((await db.item.find(1)).id, 1)
            else assert.equal(await db.item.find(1).update({ value: index % 2 ? "a" : "b" }), 1)
          }
        }
        if (transaction) await db.$transaction(body)
        else await body()
      },
    })
  }
}

const largeReads: Scenario[] = []
for (const arrays of [false, true]) {
  for (const size of [1_000, 10_000, 100_000]) {
    largeReads.push({
      name: `${arrays ? "arrays" : "objects"}-${size}`,
      units: 1,
      batch: size === 1_000 ? 20 : size === 10_000 ? 5 : 1,
      run: ({ db }) => readRows(db, arrays, size),
    })
  }
}

scenarios.push(...largeReads)

const rollback = new Error("Roll back recoverable insert fixture")
for (const kind of ["insert", "find"] as const) {
  scenarios.push({
    name: `recoverable-${kind}`,
    units: 200,
    batch: 1,
    async run({ db }) {
      let recovered = 0
      try {
        await db.$transaction(async () => {
          for (let index = 0; index < 200; index++) {
            const id = index % 2 ? 1 : index + 2
            const result =
              kind === "insert"
                ? await db.item.create({ id, value: "inserted" }).catchUniqueError(() => null)
                : await db.item.find(id).catch(() => null)
            if (result === null) recovered++
          }
          assert.equal(recovered, 100)
          if (kind === "insert") throw rollback
        })
      } catch (error) {
        if (error !== rollback) throw error
      }
    },
  })
}

scenarios.push({
  name: "test",
  units: 1,
  batch: 25,
  test: true,
  async run({ db, test }) {
    assert(test)
    await test(async () => {
      for (let index = 0; index < 10; index++) await db.item.find(1)
      await db.$transaction(async () => {
        await db.item.find(1).update({ value: "test" })
        assert.equal((await db.item.find(1)).value, "test")
      })
    })
  },
})

async function time(scenario: Scenario, clients: Clients) {
  const cpuStart = process.cpuUsage()
  const start = performance.now()
  for (let index = 0; index < scenario.batch; index++) await scenario.run(clients)
  const wall = performance.now() - start
  const cpu = process.cpuUsage(cpuStart)
  const units = scenario.units * scenario.batch
  return { wall: (wall * 1_000) / units, cpu: (cpu.user + cpu.system) / units }
}

async function runScenario(scenario: Scenario) {
  const reference = await createClients("orchid", !!scenario.test)
  try {
    const kern = await createClients("kern", !!scenario.test)
    try {
      const clients = { orchid: reference, kern }
      for (const side of sides) {
        await scenario.run(clients[side])
        if (mode === "--wire") {
          exchanges[side] = 0
          counting = true
          try {
            await scenario.run(clients[side])
          } finally {
            counting = false
          }
        }
      }
      if (mode === "--wire") {
        console.log(JSON.stringify({ name: scenario.name, units: scenario.units, exchanges }))
        return
      }
      const samples: Record<Side, Awaited<ReturnType<typeof time>>[]> = { orchid: [], kern: [] }
      for (let pair = 0; pair < pairs; pair++) {
        const order = pair % 2 ? (["kern", "orchid"] as const) : sides
        for (const side of order) samples[side].push(await time(scenario, clients[side]))
      }
      const metrics = (["wall", "cpu"] as const).map(metric => {
        const reference = samples.orchid.map(sample => sample[metric])
        const kern = samples.kern.map(sample => sample[metric])
        const overhead = kern.map((value, index) => (value / reference[index]! - 1) * 100)
        return {
          metric,
          orchid: findMedian(reference),
          kern: findMedian(kern),
          overhead: findMedian(overhead),
          interval: findMedianInterval(overhead, 0.95),
        }
      })
      console.log(JSON.stringify({ name: scenario.name, metrics }))
    } finally {
      await kern.close()
    }
  } finally {
    await reference.close()
  }
}

async function measureRss() {
  assert(rssSide === "orchid" || rssSide === "kern", "Select an RSS measurement side")
  const scenario = largeReads.find(scenario => scenario.name === scenarioName)
  assert(scenario, "Select a large-result scenario")
  const clients = await createClients(rssSide, false)
  try {
    await readRows(clients.db, scenario.name.startsWith("arrays"), 1)
    const initialRss = process.memoryUsage.rss()
    const initialPeak = process.resourceUsage().maxRSS * 1024
    const result = await scenario.run(clients)
    assert(result)
    const peakRss = process.resourceUsage().maxRSS * 1024
    console.log(
      JSON.stringify({ name: scenario.name, side: rssSide, initialRss, initialPeak, peakRss }),
    )
  } finally {
    await clients.close()
  }
}

let seeded = false
try {
  await setup.begin(async sql => {
    await sql`CREATE SCHEMA ${sql(schema)}`
    await sql`SET LOCAL search_path TO ${sql(schema)}`
    await sql`CREATE TABLE items (id integer PRIMARY KEY, value text NOT NULL)`
    await sql`INSERT INTO items VALUES (1, 'seed')`
    await sql`CREATE TYPE mood AS ENUM ('calm', 'busy')`
    await sql`CREATE TABLE mixed (
      id integer PRIMARY KEY, big bigint, label text, amount numeric(18, 3),
      stamp timestamptz, payload jsonb, mood mood, optional text
    )`
    await sql`INSERT INTO mixed
      SELECT n, 9007199254740992::bigint + n, repeat(md5(n::text), 2), n / 17.0,
        '2026-01-01 00:00:00+00'::timestamptz + n * interval '1 second',
        jsonb_build_object('id', n, 'even', n % 2 = 0),
        (CASE WHEN n % 2 = 0 THEN 'calm' ELSE 'busy' END)::mood,
        CASE WHEN n % 3 = 0 THEN NULL ELSE 'nullable ' || n END
      FROM generate_series(1, 100000) n`
  })
  seeded = true
  if (mode === "--rss") await measureRss()
  else {
    for (const scenario of scenarios) {
      if (!scenarioName || scenario.name.includes(scenarioName)) await runScenario(scenario)
    }
  }
} finally {
  try {
    if (seeded) await setup`DROP SCHEMA ${setup(schema)} CASCADE`
  } finally {
    await setup.end()
  }
}
