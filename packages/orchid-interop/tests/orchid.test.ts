import { afterAll, beforeAll, describe, expect, test } from "bun:test"

import type { OrchidInterop } from "@kern-orm/orchid-interop"
import { createOrchidInterop } from "@kern-orm/orchid-interop"
import { identifier } from "kern-db"
import { createTestHelpers } from "kern-db/testing"
import { bindSchema, defineSchema, defineTable } from "kern-orm"
import * as t from "kern-orm/types"
import { createBaseTable, QueryError, testTransaction as orchidTestTransaction } from "orchid-orm"

const BaseTable = createBaseTable()
class ItemTable extends BaseTable {
  override readonly table = "kern_orchid_item"
  override columns = this.setColumns(t => ({
    id: t.integer().primaryKey(),
    name: t.text(),
  }))
  relations = {
    children: this.hasMany(() => ChildTable, { columns: ["id"], references: ["itemId"] }),
  }
}
class ChildTable extends BaseTable {
  override readonly table = "kern_orchid_child"
  override columns = this.setColumns(t => ({
    id: t.integer().primaryKey(),
    itemId: t.integer(),
  }))
  relations = {
    item: this.belongsTo(() => ItemTable, { columns: ["itemId"], references: ["id"] }),
  }
}
const tables = { item: ItemTable, child: ChildTable }
const schema = defineSchema({
  item: defineTable("kern_orchid_item", {
    id: t.integer.primaryKey(),
    name: t.text,
  }),
})

const { DATABASE_URL } = process.env

describe.skipIf(!DATABASE_URL)("Orchid adapter", () => {
  let interop: OrchidInterop<typeof tables>
  const logged: string[] = []
  beforeAll(async () => {
    interop = await createOrchidInterop(
      {
        connection: { databaseURL: DATABASE_URL },
        orchid: { logger: { log: message => void logged.push(message), warn() {}, error() {} } },
      },
      tables,
    )
  })
  afterAll(async () => {
    await interop?.database.close()
  })

  async function withTable(callback: () => Promise<void>) {
    await interop.database.session(async () => {
      await interop.database.script(
        'CREATE TEMP TABLE kern_orchid_item (id integer PRIMARY KEY, name text NOT NULL); CREATE TEMP TABLE kern_orchid_child (id integer PRIMARY KEY, "itemId" integer REFERENCES kern_orchid_item)',
      )
      try {
        await callback()
      } finally {
        await interop.database.script("DROP TABLE kern_orchid_child; DROP TABLE kern_orchid_item")
      }
    })
  }

  test("ordinary Orchid CRUD and Kern queries share the configured connection", () =>
    withTable(async () => {
      const { database, orchid } = interop
      const db = bindSchema(schema, database)
      expect(await orchid.item.create({ id: 1, name: "Orchid" })).toEqual({ id: 1, name: "Orchid" })
      expect(await db.item.where({ id: 1 }).select("name")).toEqual([{ name: "Orchid" }])
      await db.item.insert({ id: 2, name: "Kern" })
      expect(await orchid.item.find(2).update({ name: "updated" })).toEqual(1)
      expect(await orchid.item.order("id").pluck("name")).toEqual(["Orchid", "updated"])
      expect(
        await orchid.$queryArrays`SELECT id, name FROM kern_orchid_item ORDER BY id`,
      ).toMatchObject({
        rows: [
          [1, "Orchid"],
          [2, "updated"],
        ],
      })
      expect(await orchid.item.find(1).delete()).toBe(1)
      expect(await db.item.select("id")).toEqual([{ id: 2 }])
      expect(await orchid.item.none()).toEqual([])
    }))

  test("nested writes, relation reads, and automatic hook transactions use Kern", () =>
    withTable(async () => {
      const { database, orchid } = interop
      await orchid.item.create({ id: 1, name: "parent", children: { create: [{ id: 10 }] } })
      expect(await orchid.item.select("id", { children: q => q.children.select("id") })).toEqual([
        { id: 1, children: [{ id: 10 }] },
      ])
      await expect(
        Promise.resolve(
          orchid.item
            .afterCreate(["id"], async () => {
              expect(database.isInTransaction()).toBe(true)
              await database.query`INSERT INTO kern_orchid_item VALUES (3, 'from hook')`
              throw new Error("hook failed")
            })
            .create({ id: 2, name: "hook" }),
        ),
      ).rejects.toThrow("hook failed")
      expect(await orchid.item.pluck("id")).toEqual([1])
    }))

  for (const owner of ["Kern", "Orchid"] as const) {
    test(`${owner} commits both ORMs and returns the callback value`, () =>
      withTable(async () => {
        const { database, orchid } = interop
        const db = bindSchema(schema, database)
        const transaction =
          owner === "Kern" ? database.transaction : orchid.$transaction.bind(orchid)
        expect(
          await transaction(async () => {
            expect(database.isInTransaction()).toBe(true)
            expect(orchid.$isInTransaction()).toBe(true)
            expect(orchid.item.isInTransaction()).toBe(true)
            await orchid.item.create({ id: 1, name: "Orchid" })
            await db.item.insert({ id: 2, name: "Kern" })
            return 42
          }),
        ).toBe(42)
        expect(orchid.$isInTransaction()).toBe(false)
        expect(await orchid.item.order("id").pluck("id")).toEqual([1, 2])
      }))

    test(`${owner} rolls back both ORMs`, () =>
      withTable(async () => {
        const { database, orchid } = interop
        const db = bindSchema(schema, database)
        const transaction =
          owner === "Kern" ? database.transaction : orchid.$transaction.bind(orchid)
        const failure = new Error("rollback both")
        await expect(
          transaction(async () => {
            await orchid.item.create({ id: 1, name: "Orchid" })
            await db.item.insert({ id: 2, name: "Kern" })
            throw failure
          }),
        ).rejects.toBe(failure)
        expect(await orchid.item.count()).toBe(0)
      }))

    test(`${owner} nests the other ORM with a savepoint and continues after rollback`, () =>
      withTable(async () => {
        const { database, orchid } = interop
        const outer = owner === "Kern" ? database.transaction : orchid.$transaction.bind(orchid)
        const inner = owner === "Kern" ? orchid.$transaction.bind(orchid) : database.transaction
        await outer(async () => {
          await orchid.item.create({ id: 1, name: "outer" })
          await expect(
            inner(async () => {
              await orchid.item.create({ id: 2, name: "inner" })
              await database.query`INSERT INTO kern_orchid_item VALUES (3, 'Kern')`
              await orchid.item.create({ id: 1, name: "duplicate" })
            }),
          ).rejects.toMatchObject({ code: "23505" })
          expect(await orchid.item.order("id").pluck("id")).toEqual([1])
          await inner(async () => {
            await orchid.item.create({ id: 4, name: "committed" })
          })
        })
        expect(await orchid.item.order("id").pluck("id")).toEqual([1, 4])
      }))
  }

  test("ensureTransaction joins either owner and starts outside a transaction, including withOptions", () =>
    withTable(async () => {
      const { database, orchid } = interop
      for (const transaction of [database.transaction, orchid.$transaction.bind(orchid)]) {
        await transaction(async () => {
          await orchid.$ensureTransaction(async () => {
            expect(database.isInTransaction()).toBe(true)
            // Starting a sibling would reject if ensureTransaction opened a savepoint.
            await Promise.all([
              orchid.item.count(),
              database.ensureTransaction(async () => orchid.item.count()),
            ])
          })
        })
      }
      await orchid.$withOptions({ log: false }, () =>
        orchid.$ensureTransaction(async () => {
          expect(database.isInTransaction()).toBe(true)
          await orchid.item.create({ id: 1, name: "ensured" })
        }),
      )
    }))

  test("passes isolation and rejects incompatible nested isolation", async () => {
    const { database, orchid } = interop
    await orchid.$transaction("SERIALIZABLE", async () => {
      expect(
        await database.query`SELECT current_setting('transaction_isolation')`.get(t.text),
      ).toBe("serializable")
      await expect(orchid.$transaction("READ COMMITTED", async () => {})).rejects.toThrow(
        "isolation",
      )
    })
  })

  test("preserves Orchid's query error fields", () =>
    withTable(async () => {
      const { orchid } = interop
      await orchid.item.create({ id: 1, name: "exists" })
      try {
        await orchid.item.create({ id: 1, name: "duplicate" })
        throw new Error("expected a duplicate")
      } catch (error) {
        expect(error).toBeInstanceOf(QueryError)
        expect(error).toMatchObject({
          code: "23505",
          table: "kern_orchid_item",
          constraint: "kern_orchid_item_pkey",
        })
      }
    }))

  describe("recoverable queries", () => {
    test("catch runs the query outside a transaction and receives its error", () =>
      withTable(async () => {
        const { orchid } = interop
        expect(await orchid.item.create({ id: 1, name: "one" }).catch(() => null)).toEqual({
          id: 1,
          name: "one",
        })
        expect(await orchid.item.find(2).catch(() => null)).toBe(null)
        expect(await orchid.item.order("id").pluck("id")).toEqual([1])
      }))

    for (const owner of ["Kern", "Orchid"] as const) {
      test(`${owner} transaction continues after caught failures`, () =>
        withTable(async () => {
          const { database, orchid } = interop
          const transaction =
            owner === "Kern" ? database.transaction : orchid.$transaction.bind(orchid)
          await transaction(async () => {
            await orchid.item.create({ id: 1, name: "outer" })
            expect(
              await orchid.item.create({ id: 1, name: "duplicate" }).catch(error => error),
            ).toMatchObject({ code: "23505" })
            expect(
              await orchid.item
                .create({ id: 1, name: "duplicate" })
                .catchUniqueError(error => error.constraint),
            ).toBe("kern_orchid_item_pkey")
            await expect(
              Promise.resolve(orchid.item.create({ id: 1, name: "duplicate" }).recoverable()),
            ).rejects.toBeInstanceOf(QueryError)
            await orchid.item.create({ id: 2, name: "after" })
          })
          expect(await orchid.item.order("id").pluck("id")).toEqual([1, 2])
        }))
    }

    test("an orCreate of none() recovers its statement in a nested Kern transaction and rejects selecting relations", () =>
      withTable(async () => {
        const { database, orchid } = interop
        const create = (name: string) =>
          orchid.item.findBy({ id: 1 }).none().orCreate({ id: 1, name })
        await database.transaction(async () => {
          await create("created").recoverable()
          const createMarked = (name: string) =>
            orchid.item.findBy({ id: 4 }).none().recoverable().orCreate({ id: 4, name })
          await createMarked("marked")
          await expect(Promise.resolve(createMarked("duplicate"))).rejects.toMatchObject({
            code: "23505",
          })
          expect(await create("duplicate").catchUniqueError(error => error.constraint)).toBe(
            "kern_orchid_item_pkey",
          )
          await expect(
            Promise.resolve(
              orchid.item
                .findBy({ id: 3 })
                .none()
                .select("id", { children: q => q.children.select("id") })
                .orCreate({ id: 3, name: "relations" })
                .recoverable(),
            ),
          ).rejects.toThrow("recoverable writes of .none() that select relations")
          // The savepoint covers only the statement, so a failure of the transform keeps the row, as in Orchid.
          const failure = new Error("transform failed")
          expect(
            await orchid.item
              .findBy({ id: 5 })
              .none()
              .orCreate({ id: 5, name: "transformed" })
              .transform(() => {
                throw failure
              })
              .catch(error => error),
          ).toBe(failure)
          await orchid.item.create({ id: 2, name: "after" })
        })
        expect(await orchid.item.order("id").pluck("name")).toEqual([
          "created",
          "after",
          "marked",
          "transformed",
        ])
      }))

    test("rolls back every statement of a failed nested write", () =>
      withTable(async () => {
        const { database, orchid } = interop
        await database.transaction(async () => {
          await orchid.item.create({ id: 1, name: "outer" })
          await expect(
            orchid.item
              .create({ id: 2, name: "parent", children: { create: [{ id: 10 }, { id: 10 }] } })
              .catch(error => Promise.reject(error)),
          ).rejects.toMatchObject({ code: "23505" })
        })
        expect(await orchid.item.pluck("id")).toEqual([1])
        expect(await orchid.child.count()).toBe(0)
      }))
  })

  test("returned thenables after await retain the transaction in Bun and Node", () =>
    withTable(async () => {
      const { database, orchid } = interop
      const getQuery = async () => {
        await Promise.resolve()
        return orchid.item.create({ id: 1, name: "returned" })
      }
      await expect(
        database.transaction(async () => {
          expect(await getQuery()).toEqual({ id: 1, name: "returned" })
          throw new Error("rollback")
        }),
      ).rejects.toThrow("rollback")
      expect(await orchid.item.count()).toBe(0)
    }))

  test("keeps the schema and log options of a transaction for a query that its callback returns without awaiting it", async () => {
    const { database, orchid } = interop
    const rollback = new Error("roll back the schema")
    const schema = `kern_orchid_direct_${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`
    logged.length = 0
    await expect(
      database.transaction(async () => {
        await database.query`CREATE SCHEMA ${identifier(schema)}`
        await database.query`CREATE TABLE ${identifier(schema)}.kern_orchid_item (name text NOT NULL)`
        await database.query`INSERT INTO ${identifier(schema)}.kern_orchid_item VALUES (${schema})`
        const name = await orchid.$transaction(
          { schema, log: true },
          // The types of Orchid ORM reject a callback that returns a query rather than a promise, which untyped code can still pass.
          (() => orchid.item.get("name")) as unknown as () => Promise<string>,
        )
        expect(name).toBe(schema)
        expect(logged).toEqual(
          expect.arrayContaining([expect.stringContaining(`"${schema}"."kern_orchid_item"`)]),
        )
        throw rollback
      }),
    ).rejects.toBe(rollback)
  })

  test("rejects parent queries during an active savepoint and late queries after it", () =>
    withTable(async () => {
      const { database, orchid } = interop
      const started = Promise.withResolvers<void>()
      const release = Promise.withResolvers<void>()
      let late!: Promise<unknown>
      const invokeLate = Promise.withResolvers<void>()
      await database.transaction(async () => {
        const child = orchid.$transaction(async () => {
          late = invokeLate.promise.then(() => orchid.item.create({ id: 2, name: "late" }))
          started.resolve()
          await release.promise
        })
        await started.promise
        try {
          await expect(
            Promise.resolve(orchid.item.create({ id: 1, name: "parent" })),
          ).rejects.toThrow("nested")
        } finally {
          release.resolve()
        }
        await child
        invokeLate.resolve()
        await expect(late).rejects.toThrow()
        expect(await orchid.item.count()).toBe(0)
      })
    }))

  test("Kern test transactions isolate Orchid and preserve production ensureTransaction semantics", async () => {
    const { database, orchid } = await createOrchidInterop(
      { connection: { databaseURL: DATABASE_URL }, database: { test: true } },
      tables,
    )
    try {
      const { testTransaction } = createTestHelpers(database, { before() {}, after() {} })
      await testTransaction(async () => {
        await database.script(
          "CREATE TEMP TABLE kern_orchid_item (id integer PRIMARY KEY, name text NOT NULL)",
        )
        expect(orchid.$isInTransaction()).toBe(false)
        await orchid.$ensureTransaction(async () => {
          expect(orchid.$isInTransaction()).toBe(true)
          await orchid.item.create({ id: 1, name: "test" })
        })
        expect(orchid.$isInTransaction()).toBe(false)
        expect(await orchid.item.count()).toBe(1)
      })
      await expect(Promise.resolve(orchid.item.count())).rejects.toThrow("test")
      await testTransaction(async () => {
        expect(
          await database.query`SELECT to_regclass('kern_orchid_item')::text`.get(t.text.nullable()),
        ).toBe(null)
      })
    } finally {
      await database.close()
    }
  })

  test("failed automatic Orchid writes roll back inside a Kern test transaction", async () => {
    const { database, orchid } = await createOrchidInterop(
      { connection: { databaseURL: DATABASE_URL }, database: { test: true } },
      tables,
    )
    try {
      const { testTransaction } = createTestHelpers(database, { before() {}, after() {} })
      await testTransaction(async () => {
        await database.script(
          'CREATE TEMP TABLE kern_orchid_item (id integer PRIMARY KEY, name text NOT NULL); CREATE TEMP TABLE kern_orchid_child (id integer PRIMARY KEY, "itemId" integer REFERENCES kern_orchid_item)',
        )
        await expect(
          Promise.resolve(
            orchid.item
              .afterCreate(["id"], async () => {
                expect(database.isInTransaction()).toBe(true)
                throw new Error("hook failed")
              })
              .create({ id: 1, name: "hook" }),
          ),
        ).rejects.toThrow("hook failed")
        await database.query`INSERT INTO kern_orchid_child (id) VALUES (10)`
        await expect(
          Promise.resolve(
            orchid.item.create({ id: 2, name: "parent", children: { create: [{ id: 10 }] } }),
          ),
        ).rejects.toMatchObject({ code: "23505" })
        expect(await orchid.item.count()).toBe(0)
        expect(database.isInTransaction()).toBe(false)
      })
    } finally {
      await database.close()
    }
  })

  test("Orchid testTransaction rejects before opening its fallback transaction", async () => {
    const { database, orchid } = await createOrchidInterop(
      { connection: { databaseURL: DATABASE_URL } },
      tables,
    )
    try {
      await expect(orchidTestTransaction.start(orchid)).rejects.toThrow("use Kern test helpers")
      expect(database.isInTransaction()).toBe(false)
    } finally {
      await database.close()
    }
  })

  test("rejects table-declared commit hooks when constructing the adapter", async () => {
    class HookTable extends BaseTable {
      override readonly table = "hooked"
      override columns = this.setColumns(t => ({ id: t.integer().primaryKey() }))
      init() {
        this.afterCreateCommit([], () => {})
      }
    }
    await expect(
      createOrchidInterop({ connection: { databaseURL: DATABASE_URL } }, { hooked: HookTable }),
    ).rejects.toThrow("afterCreateCommit")
  })

  test("rejects the db option of Orchid, which would run the queries on another pool", async () => {
    const orchid = { log: false, db: interop.orchid.$qb }
    await expect(
      // @ts-expect-error Orchid prefers db to the adapter.
      createOrchidInterop({ connection: { databaseURL: DATABASE_URL }, orchid }, tables),
    ).rejects.toThrow("db option")
  })

  test("concurrent transactions keep separate connections and context", async () => {
    const { database, orchid } = interop
    const ready = Promise.withResolvers<void>()
    // Keeps a rejection of the barrier handled when both sides fail before awaiting it.
    ready.promise.catch(() => {})
    let started = 0
    const run = (name: string, start: <T>(callback: () => Promise<T>) => Promise<T>) =>
      start(async () => {
        await database.query`SELECT set_config('kern.test_owner', ${name}, true)`
        if (++started === 2) ready.resolve()
        await ready.promise
        expect(
          await orchid.$query`SELECT current_setting('kern.test_owner') AS owner`,
        ).toMatchObject({ rows: [{ owner: name }] })
        return (await orchid.$query`SELECT pg_backend_pid() AS pid`).rows[0]!.pid
      }).catch((error: unknown) => {
        // A side that fails before both have started releases the other.
        ready.reject(error)
        throw error
      })
    const [a, b] = await Promise.all([
      run("Kern", database.transaction),
      run("Orchid", callback => orchid.$transaction(callback)),
    ])
    expect(a).not.toBe(b)
  })

  test("concurrent transactions keep their own Orchid schema scopes, which nested transactions restore", async () => {
    const { database, orchid } = interop
    // Each transaction creates its schemas and rolls them back, so a scope that leaks from the other transaction names a schema that does not exist in it.
    const rollback = new Error("roll back the schemas")
    const started = Promise.withResolvers<void>()
    // Keeps a rejection of the barrier handled when both sides fail before awaiting it.
    started.promise.catch(() => {})
    let count = 0
    // A suffix of the run keeps concurrent runs of the test from waiting for the names of each other's schemas.
    const suffix = crypto.randomUUID().replaceAll("-", "").slice(0, 12)
    const readName = () => orchid.item.get("name")
    const run = (owner: string, start: <T>(callback: () => Promise<T>) => Promise<T>) => {
      const schema = `kern_orchid_${owner}_${suffix}`
      const nested = `${schema}_nested`
      return orchid
        .$withOptions({ schema }, () =>
          start(async () => {
            for (const name of [schema, nested]) {
              await database.query`CREATE SCHEMA ${identifier(name)}`
              await database.query`CREATE TABLE ${identifier(name)}.kern_orchid_item (name text NOT NULL)`
              await database.query`INSERT INTO ${identifier(name)}.kern_orchid_item VALUES (${name})`
            }
            if (++count === 2) started.resolve()
            await started.promise
            expect(await readName()).toBe(schema)
            await database.transaction(async () => {
              expect(await readName()).toBe(schema)
            })
            await orchid.$transaction({ schema: nested }, async () => {
              expect(await readName()).toBe(nested)
            })
            expect(await readName()).toBe(schema)
            const failure = new Error("roll back the nested scope")
            await expect(
              orchid.$transaction({ schema: nested }, async () => {
                expect(await readName()).toBe(nested)
                throw failure
              }),
            ).rejects.toBe(failure)
            expect(await readName()).toBe(schema)
            throw rollback
          }),
        )
        .catch((error: unknown) => {
          // A side that fails before both have started releases the other.
          started.reject(error)
          return error
        })
    }
    expect(
      await Promise.all([
        run("kern", database.transaction),
        run("orchid", callback => orchid.$transaction(callback)),
      ]),
    ).toEqual([rollback, rollback])
  })

  test("rejects unsupported hooks and transaction options before writing", () =>
    withTable(async () => {
      const { orchid } = interop
      expect(() => orchid.$afterCommit(() => {})).toThrow("afterCommit")
      expect(() => orchid.item.afterCreateCommit([], () => {})).toThrow("afterCreateCommit")
      for (const options of [
        { readOnly: true },
        { deferrable: false },
        { role: "some_role" },
        { setConfig: { statement_timeout: "1000" } },
      ]) {
        let called = false
        await expect(
          orchid.$transaction(options, async () => {
            called = true
          }),
        ).rejects.toThrow("does not support")
        expect(called).toBe(false)
      }
      await expect(
        orchid.$withOptions({ role: "some_role" }, async () => orchid.item.count()),
      ).rejects.toThrow("role")
      expect(await orchid.item.count()).toBe(0)
    }))

  test("rejects transaction control in SQL text before it ends the transaction", () =>
    withTable(async () => {
      const { database, orchid } = interop
      const failure = new Error("rollback after COMMIT")
      await expect(
        database.transaction(async () => {
          await orchid.$query`INSERT INTO kern_orchid_item VALUES (1, 'uncommitted')`
          await expect(Promise.resolve(orchid.$query`COMMIT`)).rejects.toThrow(
            "transaction control",
          )
          await expect(Promise.resolve(orchid.$queryArrays`/* raw */ SAVEPOINT x`)).rejects.toThrow(
            "transaction control",
          )
          await expect(Promise.resolve(orchid.$query`; COMMIT`)).rejects.toThrow(
            "transaction control",
          )
          throw failure
        }),
      ).rejects.toBe(failure)
      expect(await orchid.item.count()).toBe(0)
    }))
})
