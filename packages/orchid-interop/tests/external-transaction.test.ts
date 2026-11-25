import { afterAll, describe, expect, test } from "bun:test"

import { runInOrchidTransaction } from "@kern-orm/orchid-interop"
import { createDatabase, identifier } from "kern-db"
import { postgresJsDriver } from "kern-db/postgres-js"
import * as t from "kern-db/types"
import { defineMigrations, migrate, MigrationError } from "kern-migrations"
import { testTransaction } from "orchid-orm"
import { createDb } from "orchid-orm/postgres-js"
import postgres from "postgres"

const { DATABASE_URL } = process.env

describe.skipIf(!DATABASE_URL)("migrations in a test transaction of native Orchid", () => {
  const orchid = createDb({ databaseURL: DATABASE_URL })
  /** Database of the migrator, whose pool also reads what other connections committed. */
  const database = createDatabase({
    // The cleanup drops the schema if a failure left it, and PostgreSQL notices that it is missing otherwise.
    driver: postgresJsDriver(postgres(DATABASE_URL!, { onnotice: () => {} })),
  })
  const schemaName = `kern_orchid_${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`
  const schema = identifier(schemaName)
  const createItem = { up: "CREATE TABLE item (id integer PRIMARY KEY)" }
  const history = defineMigrations({ "0001_create_item": createItem })

  afterAll(async () => {
    await testTransaction.close(orchid)
    await database.script`DROP SCHEMA IF EXISTS ${schema} CASCADE`
    await database.close()
  })

  const readSearchPath = async () =>
    (await orchid.query<{ search_path: string }>`SHOW search_path`).rows[0]!.search_path
  const readItems = async () =>
    (
      await orchid
        .$getAdapter()
        .query<{ id: number }>(`SELECT id FROM ${schemaName}.item ORDER BY id`)
    ).rows
  const readVersions = async () =>
    (
      await orchid
        .$getAdapter()
        .query<{ key: string }>(`SELECT key FROM ${schemaName}.kern_migration ORDER BY key`)
    ).rows.map(row => row.key)

  test("apply with the database of the callback form, survive a nested level, survive a failed migration, and roll back with the outer level", async () => {
    await testTransaction.start(orchid)
    try {
      const searchPath = await readSearchPath()
      await runInOrchidTransaction(orchid, external => migrate(external, history, { schemaName }))
      expect(await readItems()).toEqual([])
      expect(await readVersions()).toEqual(["0001_create_item"])
      expect(await readSearchPath()).toBe(searchPath)

      await testTransaction.start(orchid)
      try {
        await orchid.$getAdapter().query(`INSERT INTO ${schemaName}.item VALUES ($1)`, [1])
        expect(await readItems()).toEqual([{ id: 1 }])
      } finally {
        await testTransaction.rollback(orchid)
      }
      expect(await readItems()).toEqual([])
      await orchid.$getAdapter().query(`INSERT INTO ${schemaName}.item VALUES ($1)`, [2])
      expect(await readItems()).toEqual([{ id: 2 }])

      const failing = defineMigrations({
        "0001_create_item": createItem,
        "0002_create_tag": {
          up: "CREATE TABLE tag (id integer PRIMARY KEY); SELECT 1 / 0",
        },
      })
      const failed = runInOrchidTransaction(orchid, database, () =>
        migrate(database, failing, { schemaName }),
      )
      await expect(failed).rejects.toBeInstanceOf(MigrationError)
      await expect(failed).rejects.toMatchObject({
        key: "0002_create_tag",
        cause: { code: "22012" },
      })
      const { rows: tags } = await orchid.query<{ name: string | null }>`
        SELECT to_regclass(${`${schemaName}.tag`}) AS name
      `
      expect(tags).toEqual([{ name: null }])
      expect(await readVersions()).toEqual(["0001_create_item"])
      expect(await readItems()).toEqual([{ id: 2 }])
    } finally {
      await testTransaction.rollback(orchid)
    }

    expect(
      await database.query`SELECT nspname FROM pg_namespace WHERE nspname = ${schemaName}`.pluck(
        t.text,
      ),
    ).toEqual([])
  })
})
