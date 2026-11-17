import { afterAll, beforeAll, describe, expect, test } from "bun:test"

import { createRecordingDriver } from "@kern-orm/test-harness/recording-driver"
import { createDatabase, QueryError } from "kern-db"
import * as t from "kern-db/types"
import { createBaseTable } from "orchid-orm"
import { Adapter as PostgresJsAdapter, orchidORM } from "orchid-orm/postgres-js"
import postgres from "postgres"

import type { OrchidResult, PostgresJsExecutor } from "./postgres-js"
import { createOrchidPostgresJsDriver, createPostgresJsExecutor } from "./postgres-js"

describe("Orchid postgres.js executor", () => {
  test.each([
    { transform: { column: { from: (value: string) => value } } },
    { transform: { row: { from: (value: unknown) => value } } },
    { transform: { value: { from: (value: unknown) => value } } },
  ])("rejects postgres.js result transforms: %j", async options => {
    const database = createDatabase({ driver: createRecordingDriver().driver })
    const unsupported = postgres(options)
    try {
      expect(() => createPostgresJsExecutor(database, unsupported)).toThrow(TypeError)
    } finally {
      await unsupported.end()
      await database.close()
    }
  })
})

const { DATABASE_URL } = process.env

describe.skipIf(!DATABASE_URL)("Orchid codecs over the interop driver", () => {
  let client: postgres.Sql
  let database: ReturnType<typeof createDatabase>
  let executor: PostgresJsExecutor

  beforeAll(async () => {
    client = PostgresJsAdapter.configure({ databaseURL: DATABASE_URL }) as postgres.Sql
    // The driver serializes parameters with the codecs of the same client, as in createOrchidInterop.
    database = createDatabase({ driver: createOrchidPostgresJsDriver(client) })
    // Native startup loads database-defined types into the codec registry.
    await client`SELECT 1`
    executor = createPostgresJsExecutor(database, client)
  })
  afterAll(() => database?.close())

  async function compare(text: string, values: unknown[] = [], arrays = false) {
    const native = await PostgresJsAdapter.queryClient(client, text, values, arrays)
    const actual = await executor[arrays ? "arrays" : "query"](text, values)
    expect(normalize(actual)).toEqual(normalize(native))
    return actual
  }

  test.each([false, true])(
    "matches scalar values, arrays and SQL null (arrays=%s)",
    async arrays => {
      const result = await compare(
        `SELECT
      true AS flag, 42::int2 AS small, 2147483647::int4 AS integer,
      9223372036854775807::int8 AS big, 1.25::float4 AS real, 'NaN'::float8 AS nan,
      123456789.123456789::numeric AS decimal, 'hello'::text AS text,
      '2026-01-02'::date AS day,
      '2026-01-02 03:04:05.123456'::timestamp AS stamp,
      '2026-01-02 03:04:05.123456+00'::timestamptz AS zoned,
      'infinity'::timestamptz AS infinity,
      '-2 years 3 mons -4 days -05:06:07.123456'::interval AS duration,
      '{"nested":[1,true,null,"x"]}'::jsonb AS json,
      decode('00ff5c', 'hex') AS bytes,
      ARRAY[true,false,NULL] AS flags,
      ARRAY[1,2,NULL] AS integers,
      ARRAY['NULL','a,b','a"b','a\\b',NULL] AS strings,
      ARRAY[['2026-01-02 03:04:05.123456+00'::timestamptz,NULL]] AS stamps,
      ARRAY['1 day 02:03:04'::interval,NULL] AS durations,
      ARRAY['{"x":1}'::jsonb,'null'::jsonb,NULL] AS documents,
      ARRAY[decode('00ff', 'hex'),NULL] AS buffers,
      '[0:2]={1,NULL,3}'::int[] AS lower_bound,
      ARRAY['(1,2),(3,4)'::box, NULL] AS boxes,
      NULL::int AS missing`,
        [],
        arrays,
      )
      if (!arrays) {
        expect(result.rows[0]).toMatchObject({
          big: "9223372036854775807",
          decimal: "123456789.123456789",
          stamp: "2026-01-02 03:04:05.123456",
          missing: null,
          buffers: [Buffer.from([0, 255]), null],
        })
      }
    },
  )

  test.each([false, true])("matches parameter serialization (arrays=%s)", async arrays => {
    await compare(
      `SELECT $1::jsonb AS json, $2::json AS json_array,
      $3::jsonb[] AS documents, $4::int[] AS integers, $5::text[][] AS strings,
      $6::timestamptz AS stamp, $7::date[] AS dates,
      $8::bytea AS bytes, $9::bytea[] AS buffers, $10::bool AS flag,
      $11::int8 AS big, $12::interval AS duration, $13::text AS missing`,
      [
        { x: [1, true, null] },
        [1, "two", null],
        [{ x: 1 }, null, { x: [1, 2] }],
        [1, null, 3],
        [
          ["NULL", null],
          ["a,b", 'a"\\b'],
        ],
        new Date("2026-01-02T03:04:05.123Z"),
        [new Date("2026-01-02T00:00:00Z"), null],
        Buffer.from([0, 255, 92]),
        [Buffer.from([1, 2]), null],
        true,
        9223372036854775807n,
        "1 day 02:03:04",
        null,
      ],
      arrays,
    )
  })

  test("uses input OIDs even when result OIDs differ and distinguishes JSON arrays from SQL arrays", async () => {
    await compare("SELECT ($1::jsonb)->>0 AS first, ($2::int[])[1] AS second", [
      [1, 2],
      [1, 2],
    ])
    await compare("SELECT $1::text AS text, $2::jsonb AS json", ["hello", "hello"])
  })

  test("preserves the native rejection of a ragged PostgreSQL array", async () => {
    const text = "SELECT $1::jsonb[]"
    const values = [[{ x: 1 }, [1, 2]]]
    await expect(PostgresJsAdapter.queryClient(client, text, values)).rejects.toMatchObject({
      code: "22P02",
    })
    await expect(executor.query(text, values)).rejects.toMatchObject({ code: "22P02" })
  })

  test.each([false, true])(
    "preserves empty-result fields and duplicate names (arrays=%s)",
    async arrays => {
      await compare(
        "SELECT 1 AS repeated, 'text' AS repeated, NULL::jsonb AS missing WHERE false",
        [],
        arrays,
      )
      await compare(
        "SELECT 1 AS repeated, 'text' AS repeated, 2 AS \"__proto__\", 3 AS constructor",
        [],
        arrays,
      )
    },
  )

  test("preserves row counts without RETURNING and has no fields for empty SQL", async () => {
    await compare("")
    await database.transaction(async () => {
      const created = await executor.query("CREATE TEMP TABLE codec_count (id int) ON COMMIT DROP")
      expect(created).toEqual({ rowCount: null, rows: [], fields: [] })
      const result = await executor.query("INSERT INTO codec_count VALUES ($1), ($2)", [1, 2])
      expect(result).toEqual({ rowCount: 2, rows: [], fields: [] })
      expect(await executor.query("UPDATE codec_count SET id = 3 WHERE false")).toEqual({
        rowCount: 0,
        rows: [],
        fields: [],
      })
    })
  })

  test("uses custom codecs from the configured registry and skips parsers for null", async () => {
    const oid = 20
    const parse = client.options.parsers[oid]!
    const serialize = client.options.serializers[oid]!
    try {
      client.options.parsers[oid] = value => BigInt(value)
      client.options.serializers[oid] = value => String(value.amount)
      const result = await compare("SELECT $1::int8 AS amount, NULL::int8 AS missing", [
        { amount: 9007199254740993n },
      ])
      expect(result.rows).toEqual([{ amount: 9007199254740993n, missing: null }])
    } finally {
      client.options.parsers[oid] = parse
      client.options.serializers[oid] = serialize
    }
  })

  test("uses database-defined enums, domains and arrays loaded by the native client", async () => {
    // The second client reads the types on its start, so they are committed; a suffix of the run keeps concurrent runs from waiting for the name of each other's schema.
    const schema = `codec_types_${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`
    await database.script(`
      CREATE SCHEMA ${schema};
      CREATE TYPE ${schema}.status AS ENUM ('draft', 'published');
      CREATE DOMAIN ${schema}.amount AS int CHECK (VALUE >= 0);
      CREATE TYPE ${schema}.entry AS (id int, label text)
    `)
    try {
      const configured = PostgresJsAdapter.configure({ databaseURL: DATABASE_URL }) as postgres.Sql
      const configuredDatabase = createDatabase({
        driver: createOrchidPostgresJsDriver(configured),
      })
      try {
        await configured`SELECT 1`
        const dynamic = createPostgresJsExecutor(configuredDatabase, configured)
        const text = `SELECT $1::${schema}.status[] AS statuses,
          $2::${schema}.amount[] AS amounts,
          ARRAY[ROW(1,'a,b')::${schema}.entry,NULL] AS entries`
        const values = [
          ["draft", null, "published"],
          [1, null, 2],
        ]
        const native = await PostgresJsAdapter.queryClient(configured, text, values)
        const actual = await dynamic.query(text, values)
        expect(normalize(actual)).toEqual(normalize(native))
        expect(actual.rows[0]).toMatchObject({
          statuses: ["draft", null, "published"],
          amounts: [1, null, 2],
        })
      } finally {
        await configuredDatabase.close()
      }
    } finally {
      await database.script(`DROP SCHEMA ${schema} CASCADE`)
    }
  })

  test("runs compiled Orchid inserts and updates on Kern's transaction connection", async () => {
    const BaseTable = createBaseTable()
    class Entry extends BaseTable {
      override readonly table = "codec_entries"
      override columns = this.setColumns(t => ({
        id: t.integer().primaryKey(),
        document: t.json(),
        tags: t.array(t.text()),
        stamp: t.timestamp(),
      }))
    }
    const orchid = orchidORM({ databaseURL: DATABASE_URL }, { entry: Entry })
    const ddl =
      "CREATE TEMP TABLE codec_entries (id int PRIMARY KEY, document jsonb, tags text[], stamp timestamptz) ON COMMIT DROP"
    const queries = [
      orchid.entry
        .create({
          id: 1,
          document: { x: [true, null] },
          tags: ["a,b", "NULL"],
          stamp: new Date("2026-01-02T03:04:05.123Z"),
        })
        .toSQL(),
      orchid.entry
        .find(1)
        .update({ document: { changed: true } })
        .selectAll()
        .toSQL(),
      orchid.entry.selectAll().toSQL(),
    ]
    try {
      const expected: ReturnType<typeof normalize>[] = []
      const statements: { text: string; values?: unknown[] }[] = []
      await client.begin(async native => {
        await native.unsafe(ddl)
        for (const query of queries) {
          if (!("text" in query)) throw new Error("Expected one compiled Orchid statement")
          statements.push({
            text: query.text,
            values: query.values,
          })
          expected.push(
            normalize(await PostgresJsAdapter.queryClient(native, query.text, query.values)),
          )
        }
      })
      await database.transaction(async () => {
        await database.script(ddl)
        for (let index = 0; index < statements.length; index++) {
          const { text, values } = statements[index]!
          expect(normalize(await executor.query(text, values))).toEqual(expected[index]!)
        }
      })
    } finally {
      await orchid.$close()
    }
  })

  test("rolls back Kern and Orchid writes together to the same savepoint", async () => {
    await database.transaction(async () => {
      await database.script("CREATE TEMP TABLE codec_rollback (id int PRIMARY KEY) ON COMMIT DROP")
      await executor.query("INSERT INTO codec_rollback VALUES ($1)", [1])
      await expect(
        database.transaction(async () => {
          await database.query`INSERT INTO codec_rollback VALUES (${2})`
          await executor.query("INSERT INTO codec_rollback VALUES ($1)", [3])
          await executor.query("INSERT INTO codec_rollback VALUES ($1)", [1])
        }),
      ).rejects.toBeInstanceOf(QueryError)
      expect(await database.query`SELECT id FROM codec_rollback`.pluck(t.integer)).toEqual([1])
      expect((await executor.query("SELECT id FROM codec_rollback")).rows).toEqual([{ id: 1 }])
    })
  })

  test("rejects a late query of a finished Kern transaction", async () => {
    const start = Promise.withResolvers<void>()
    let late: Promise<OrchidResult> | undefined
    await database.transaction(async () => {
      late = start.promise.then(() => executor.query("SELECT $1::int", [1]))
    })
    start.resolve()
    await expect(late).rejects.toThrow("already finished")
  })

  test("rejects a parent query while its Kern savepoint is active", async () => {
    await database.transaction(async () => {
      const entered = Promise.withResolvers<void>()
      const release = Promise.withResolvers<void>()
      const child = database.transaction(async () => {
        entered.resolve()
        await release.promise
      })
      await entered.promise
      try {
        await expect(executor.query("SELECT $1::int", [1])).rejects.toThrow(
          "a nested transaction is running",
        )
      } finally {
        release.resolve()
        await child
      }
    })
  })
})

// Ignore native Result-array properties and metadata beyond Orchid's QueryResult contract.
function normalize(result: OrchidResult<unknown>): OrchidResult<unknown> {
  return {
    rowCount: result.rowCount,
    rows: Array.from(result.rows),
    fields: result.fields?.map(field => ({ name: field.name })) ?? [],
  }
}
