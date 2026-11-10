import { describe, expect, it } from "bun:test"

import { createRecordingDriver } from "../../testing/recording-driver"
import { createSubquery } from "../ast/testing"
import { text } from "../database/codecs/text"
import type { DriverResult } from "../database/driver"
import { NotFoundError } from "../database/result"
import {
  identifier as identifierFragment,
  param as paramFragment,
  sql as sqlFragment,
} from "../database/sql/fragment"
import { identifier, sql } from "../expression/sql"
import { lower } from "../lowering/testing"
import type { AnySelectQuery } from "../query/select"
import { from, SelectQuery } from "../query/select"
import { many } from "../schema/relation"
import { defineSchema } from "../schema/schema"
import { defineTable } from "../table/table"
import * as t from "../types"

import { createDatabase } from "./database"

const post = defineTable("post", {
  id: t.uuid,
  title: t.text,
})
const comment = defineTable("comment", {
  id: t.uuid,
})
const schema = defineSchema({ post })

function connectRecorded() {
  const { driver, statements, scripts } = createRecordingDriver({
    respond: () => ({ rows: [["post-id"]] }),
  })
  const db = createDatabase({ driver }).bind(schema, { schemaName: "app" })
  return { db, statements, scripts }
}

it("executes a table entry query when awaited", async () => {
  const { db, statements } = connectRecorded()

  const rows: { id: string }[] = await db.post.where({ title: "Draft" }).select("id")

  expect(rows).toEqual([{ id: "post-id" }])
  expect(statements).toEqual([
    {
      connection: "pool",
      text: 'SELECT "post"."id" AS "id" FROM "app"."post" AS "post" WHERE "post"."title" = $1',
      parameters: ["Draft"],
    },
  ])
})

it("decodes selected fields with the types of their expressions", async () => {
  const { driver } = createRecordingDriver({
    respond: () => ({ rows: [["post-id", "Draft", "t", "DRAFT", "5"]] }),
  })
  const db = createDatabase({ driver }).bind(schema)
  const label = t.text.transform({ decode: value => `label: ${value}` })

  const rows = await db.post.select("id").select(columns => ({
    heading: columns.title,
    isDraft: columns.title.eq("Draft"),
    label: sql(label)`upper(${columns.title})`,
    length: sql(t.integer)`length(${columns.title})`,
  }))

  expect(rows).toEqual([
    { id: "post-id", heading: "Draft", isDraft: true, label: "label: DRAFT", length: 5 },
  ])
})

it("returns the values of a query made by pluck", async () => {
  const { db } = connectRecorded()

  expect(await db.post.pluck("id")).toEqual(["post-id"])
  expect(await db.$execute(schema.post.pluck("id"))).toEqual(["post-id"])
})

it("returns the row of a query of one row or its value", async () => {
  const { db } = connectRecorded()

  expect(await db.post.select("id").take()).toEqual({ id: "post-id" })
  expect(await db.post.get("id")).toBe("post-id")
  expect(await db.$execute(schema.post.get("id").optional())).toBe("post-id")
})

it("rejects a query of one row without a row unless optional", async () => {
  const { driver } = createRecordingDriver()
  const db = createDatabase({ driver }).bind(schema)

  await expect(Promise.resolve(db.post.take())).rejects.toThrow(NotFoundError)
  await expect(db.$execute(schema.post.get("id"))).rejects.toThrow(NotFoundError)
  expect(await db.post.take().optional()).toBeUndefined()
  expect(await db.$execute(schema.post.get("id").optional())).toBeUndefined()
})

it("executes a query built by use on the Db of the query it is called on", async () => {
  const { db, statements } = connectRecorded()

  const rows = await db.post.use(posts => posts.select("id"))

  expect(rows).toEqual([{ id: "post-id" }])
  expect(statements).toMatchObject([
    { text: 'SELECT "post"."id" AS "id" FROM "app"."post" AS "post"' },
  ])
})

it("executes a query of $select of its schema in its PostgreSQL schema", async () => {
  const { driver, statements } = createRecordingDriver({
    respond: () => ({ rows: [['["post-id"]']] }),
  })
  const db = createDatabase({ driver }).bind(schema, { schemaName: "app" })
  const query = schema.$select({
    post: schema.post.select("id").take(),
  })

  expect(await db.$execute(query)).toEqual({ post: { id: "post-id" } })
  expect(statements[0]!.text).toContain('FROM "app"."post"')
})

describe("$query", () => {
  /** Db of the schema in the PostgreSQL schema of `tenant.name`, read when a query compiles, over a recording driver that answers every statement with `result`. */
  function connectTenant(result: Partial<DriverResult> = {}) {
    const tenant = { name: "app" }
    const { driver, statements } = createRecordingDriver({ respond: () => result })
    const database = createDatabase({ driver })
    const db = database.bind(schema, { schemaName: () => tenant.name })
    return { database, db, statements, tenant }
  }

  it("executes a statement when awaited, naming the tables of the Db in the PostgreSQL schema that it resolves at each compilation", async () => {
    const { db, statements, tenant } = connectTenant({ count: 3 })
    const query = db.$query`UPDATE ${db.post} SET title = ${"Draft"} WHERE ${sql`id = ${"post-id"}`}`

    expect(await query).toBe(3)
    tenant.name = "tenant"
    expect(query.toSQL().text).toBe('UPDATE "tenant"."post" SET title = $1 WHERE id = $2')
    await query
    expect(statements).toEqual([
      {
        connection: "pool",
        text: 'UPDATE "app"."post" SET title = $1 WHERE id = $2',
        parameters: ["Draft", "post-id"],
      },
      {
        connection: "pool",
        text: 'UPDATE "tenant"."post" SET title = $1 WHERE id = $2',
        parameters: ["Draft", "post-id"],
      },
    ])
  })

  it("decodes the fields of the rows of its statement by the types of select", async () => {
    const { db } = connectTenant({ columns: ["title", "id"], rows: [["Draft", "post-id"]] })

    expect(
      await db.$query`SELECT * FROM ${db.post}`.select({
        id: t.uuid,
        title: t.text,
      }),
    ).toEqual([{ id: "post-id", title: "Draft" }])
  })

  it("interpolates a fragment of the database layer as SQL, numbering its parameters with those of the statement", () => {
    const { db } = connectTenant()
    const condition = sqlFragment`${identifierFragment("id")} = ANY(${paramFragment(text, "post-id")}, ${"other-id"})`

    expect(
      db.$query`DELETE FROM ${db.post} WHERE title = ${"Draft"} AND ${condition}`.toSQL(),
    ).toEqual({
      text: 'DELETE FROM "app"."post" WHERE title = $1 AND "id" = ANY(($2::text), $3)',
      parameters: ["Draft", "post-id", "other-id"],
    })
  })

  it("names a table by identifier as it is, keeping values as parameters", () => {
    const { db } = connectTenant()

    expect(
      db.$query`UPDATE ${identifier("tenant", "post")} SET title = ${"Draft"}`.toSQL(),
    ).toEqual({
      text: 'UPDATE "tenant"."post" SET title = $1',
      parameters: ["Draft"],
    })
  })

  it("rejects a table of another Db and a table outside the schema of its Db, when it compiles and when it executes", async () => {
    const { database, db, statements } = connectTenant()
    const query = database.bind(schema).$query`SELECT FROM ${db.post}`

    expect(() => query.toSQL()).toThrow('Table "post" interpolated into SQL is bound to another Db')
    await expect(Promise.resolve(query)).rejects.toThrow(
      'Table "post" interpolated into SQL is bound to another Db',
    )
    expect(() => db.$query`SELECT FROM ${defineSchema({ comment }).comment}`.toSQL()).toThrow(
      'Table "comment" is not part of the schema',
    )
    expect(statements).toEqual([])
  })

  it("is not executed by $execute or compiled by $compile, and cannot be a field, a value of a column, an operand, or a condition", async () => {
    const { db, statements } = connectTenant()
    const query = db.$query`SELECT 1`.get(t.text)
    const message =
      "A query of SQL text executes when it is awaited and compiles with its toSQL, not with $execute or $compile"
    const operand =
      "An expression takes a query of one value of a table, such as of get, an aggregate, or exists, not a query of SQL text"

    await expect(db.$execute(query as never)).rejects.toThrow(message)
    expect(() => db.$compile(query as never)).toThrow(message)
    expect(() => db.$select({ one: query as never })).toThrow(
      'Selected field "one" is a query of SQL text, which cannot be nested',
    )
    expect(() => db.post.insert({ id: "post-id", title: query as never })).toThrow(operand)
    expect(() => db.post.where(post => post.title.eq(query as never))).toThrow(operand)
    expect(() => db.post.where(query as never)).toThrow(operand)
    expect(statements).toEqual([])
  })
})

it("executes a script of its text or of a template that names its tables, in the ambient transaction", async () => {
  const { driver, statements, scripts } = createRecordingDriver()
  const db = createDatabase({ driver }).bind(schema, { schemaName: "app" })

  await db.$script("CREATE SCHEMA app; CREATE TABLE app.post (id uuid, title text)")
  await db.$transaction(() => db.$script`CREATE INDEX ON ${db.post} (id); ANALYZE ${schema.post}`)

  expect(scripts).toEqual([
    {
      connection: "pool",
      script: "CREATE SCHEMA app; CREATE TABLE app.post (id uuid, title text)",
    },
    { connection: 1, script: 'CREATE INDEX ON "app"."post" (id); ANALYZE "app"."post"' },
  ])
  expect(statements).toEqual([
    { connection: 1, text: "BEGIN", parameters: [] },
    { connection: 1, text: "COMMIT", parameters: [] },
  ])
})

it("executes a script of a template that interpolates a name from identifier, also of the database layer", async () => {
  const { db, scripts } = connectRecorded()

  await db.$script`ANALYZE ${identifier("comment")}; ANALYZE ${identifierFragment("app", "post")}`

  expect(scripts).toEqual([
    { connection: "pool", script: 'ANALYZE "comment"; ANALYZE "app"."post"' },
  ])
})

it("executes a script of a template that interpolates a query without values as a subquery", async () => {
  const { db, scripts } = connectRecorded()

  await db.$script`CREATE VIEW titled AS ${db.post.select("id", "title")}`

  expect(scripts).toEqual([
    {
      connection: "pool",
      script:
        'CREATE VIEW titled AS (SELECT "post"."id" AS "id", "post"."title" AS "title" FROM "app"."post" AS "post")',
    },
  ])
})

it("rejects values in the template of a script, also in a query and a sql fragment", async () => {
  const { db, scripts } = connectRecorded()
  const message =
    "A script has no parameters, so it takes no values, also in the queries and sql fragments that it interpolates"

  await expect(db.$script`SELECT ${1}`).rejects.toThrow(message)
  await expect(db.$script`SELECT ${db.post.where({ title: "x" }).pluck("id")}`).rejects.toThrow(
    message,
  )
  await expect(db.$script`SELECT ${sql`upper(${"x"})`}`).rejects.toThrow(message)
  await expect(db.$script`SELECT ${paramFragment(text, "x")}`).rejects.toThrow(message)
  expect(scripts).toEqual([])
})

it("runs a transaction of the database with the options of $transaction", async () => {
  const { db, statements } = connectRecorded()

  await db.$transaction(() => db.$script("SELECT 1"), { searchPath: ["tenant_1"] })

  expect(statements).toMatchObject([
    { text: "BEGIN" },
    { text: "SELECT set_config($1, $2, true)", parameters: ["search_path", '"tenant_1"'] },
    { text: "COMMIT" },
  ])
})

it("joins a transaction of the database with $ensureTransaction and reports it through $isInTransaction", async () => {
  const { db, statements } = connectRecorded()

  let inTransaction: boolean | undefined
  await db.$database.transaction(() =>
    db.$ensureTransaction(async () => {
      inTransaction = db.$isInTransaction()
      await db.$script("SELECT 1")
    }),
  )

  expect(db.$isInTransaction()).toBe(false)
  expect(inTransaction).toBe(true)
  expect(statements.map(({ text }) => text)).toEqual(["BEGIN", "COMMIT"])
})

it("runs a session of the database with $session and tells a transaction block with $isInTransactionBlock", async () => {
  const { db, statements } = connectRecorded()

  const blocks: boolean[] = []
  const result = await db.$session(async () => {
    blocks.push(db.$isInTransactionBlock())
    await db.$script("SELECT 1")
    await db.$transaction(async () => {
      blocks.push(db.$isInTransactionBlock())
    })
    return "done"
  })

  expect(result).toBe("done")
  expect(blocks).toEqual([false, true])
  expect(db.$isInTransactionBlock()).toBe(false)
  expect(statements).toEqual([
    { connection: 1, text: "BEGIN", parameters: [] },
    { connection: 1, text: "COMMIT", parameters: [] },
  ])
})

it("takes advisory locks in a transaction of the database with $lock and $tryLock", async () => {
  const { db, statements } = connectRecorded()

  await db.$transaction(async () => {
    await db.$lock("import")
    await db.$tryLock("export")
  })

  expect(statements).toMatchObject([
    { text: "BEGIN" },
    { text: "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", parameters: ["import"] },
    { text: "SELECT pg_try_advisory_xact_lock(hashtextextended($1, 0))", parameters: ["export"] },
    { text: "COMMIT" },
  ])
})

it("polls for an advisory lock in a session of the database with $pollLock, passing its signal", async () => {
  const { driver, statements } = createRecordingDriver({ respond: () => ({ rows: [["t"]] }) })
  const db = createDatabase({ driver }).bind(schema)
  const reason = new Error("timeout")

  await db.$session(async () => {
    await expect(db.$pollLock("import", { signal: AbortSignal.abort(reason) })).rejects.toBe(reason)
    await db.$pollLock("import")
  })

  expect(statements).toMatchObject([
    { text: "SELECT pg_try_advisory_lock(hashtextextended($1, 0))", parameters: ["import"] },
    { text: "SELECT pg_advisory_unlock(hashtextextended(key, 0)) FROM unnest($1::text[]) AS key" },
  ])
})

describe("row locks", () => {
  const message =
    "Cannot lock the rows of a query outside a transaction, where the locks would end with its statement; a test transaction alone does not count"

  it("runs a query with a row lock in a transaction", async () => {
    const { db, statements } = connectRecorded()

    await db.$transaction(async () => await db.post.select("id").forUpdate())

    expect(statements.map(({ text }) => text)).toEqual([
      "BEGIN",
      'SELECT "post"."id" AS "id" FROM "app"."post" AS "post" FOR UPDATE',
      "COMMIT",
    ])
  })

  it("rejects a statement of a query or of $select that locks rows at any depth outside a transaction, without a statement, unlike $compile", async () => {
    const { db, statements } = connectRecorded()
    const locked = db.post.select("id").forUpdate()

    await expect(db.$execute(locked)).rejects.toThrow(message)
    await expect(db.$execute(db.$schema.post.select("id").forUpdate())).rejects.toThrow(message)
    await expect(
      db.$execute(
        db.post.select(post => ({
          title: db.post.where({ id: post.id }).get("title").forShare(),
        })),
      ),
    ).rejects.toThrow(message)
    await expect(
      db.$execute(
        db.$select({
          id: db.post.take().get("id").forUpdate(),
        }),
      ),
    ).rejects.toThrow(message)

    expect(statements).toEqual([])
    expect(db.$compile(locked).text).toEndWith("FOR UPDATE")
  })

  it("rejects it in a test transaction alone, which code under test does not rely on, so that the lock is held in production too", async () => {
    const { driver, statements } = createRecordingDriver({
      respond: () => ({ rows: [["post-id"]] }),
    })
    const database = createDatabase({ driver, test: true })
    const db = database.bind(schema)
    const locked = db.post.select("id").forUpdate()

    await database.coordinator.testTransaction(async () => {
      await expect(db.$execute(locked)).rejects.toThrow(message)
      await db.$ensureTransaction(async () => await locked)
    })

    expect(statements.map(({ text }) => text)).toMatchObject([
      "BEGIN",
      expect.stringMatching(/^SAVEPOINT/),
      'SELECT "post"."id" AS "id" FROM "post" AS "post" FOR UPDATE',
      expect.stringMatching(/^RELEASE SAVEPOINT/),
      "ROLLBACK",
    ])
  })

  it("runs a mutation and a statement of SQL text that hold a lock outside a transaction, since the statement itself may rely on it", async () => {
    const { db, statements } = connectRecorded()
    const lockedId = db.post.orderBy("id").take().get("id").forUpdate({ skipLocked: true })

    await db.post.where(post => post.id.eq(lockedId)).update({ title: "Taken" })
    await db.$query`WITH taken AS (${db.post.select("id").forUpdate()}) DELETE FROM ${db.post} USING taken`

    expect(statements).toHaveLength(2)
    expect(statements[0]!.text).toContain("FOR UPDATE SKIP LOCKED")
    expect(statements[1]!.text).toContain("FOR UPDATE")
  })
})

it("leaves unbound queries unexecuted when returned from async functions", async () => {
  const { db, statements } = connectRecorded()
  const buildQuery = async () => db.$schema.post.where({ title: "Draft" })

  expect(await buildQuery()).toBeInstanceOf(SelectQuery)
  expect(statements).toEqual([])
})

it("compiles a bound query as its Db executes it", () => {
  const { db } = connectRecorded()
  const query = db.post.where({ title: "Draft" }).select("id")

  const statement = {
    text: 'SELECT "post"."id" AS "id" FROM "app"."post" AS "post" WHERE "post"."title" = $1',
    parameters: ["Draft"],
  }

  expect(query.toSQL()).toEqual(statement)
  expect(db.$compile(query)).toEqual(statement)
})

it("resolves a schema name function on each compilation of a bound query", () => {
  let tenant = "tenant_1"
  const { driver } = createRecordingDriver()
  const db = createDatabase({ driver }).bind(schema, { schemaName: () => tenant })
  const query = db.post.select("id")

  expect(query.toSQL().text).toContain('FROM "tenant_1"."post"')
  tenant = "tenant_2"
  expect(query.toSQL().text).toContain('FROM "tenant_2"."post"')
})

it("gives its PostgreSQL schema by $schemaName, calling a schema name function when read", () => {
  let tenant = "tenant_1"
  const database = createDatabase({ driver: createRecordingDriver().driver })
  const tenantDb = database.bind(schema, { schemaName: () => tenant })

  expect(tenantDb.$schemaName).toBe("tenant_1")
  tenant = "tenant_2"
  expect(tenantDb.$schemaName).toBe("tenant_2")
  expect(database.bind(schema, { schemaName: "app" }).$schemaName).toBe("app")
  expect(database.bind(schema).$schemaName).toBeUndefined()
})

it("keeps the bind options it was bound with", () => {
  const { driver } = createRecordingDriver()
  const options = { schemaName: "app" }
  const db = createDatabase({ driver }).bind(schema, options)
  options.schemaName = "other"

  expect(db.post.select("id").toSQL().text).toContain('FROM "app"."post"')
  expect(db.$schemaName).toBe("app")
})

it("gives the database it is bound to by $database", () => {
  const database = createDatabase({ driver: createRecordingDriver().driver })

  expect(database.bind(schema).$database).toBe(database)
})

it("rejects compile options of a bound query", () => {
  const { db } = connectRecorded()
  const query: AnySelectQuery = db.post

  expect(() => query.toSQL({ schemaName: "other" })).toThrow(
    "A query bound to a Db compiles with the options of its Db",
  )
})

it("rejects a table outside its schema, also in a nested query", () => {
  const { db } = connectRecorded()
  const comments = from(comment).select(() => ({
    count: sql(t.bigint)`count(*)`,
  }))
  const query = db.post.select(() => ({
    commentCount: createSubquery(lower(comments), t.bigint),
  }))
  const error = 'Table "comment" is not part of the schema'

  // @ts-expect-error The schema has no table `comment`.
  expect(() => db.$compile(from(comment))).toThrow(error)
  expect(() => db.$compile(query)).toThrow(error)
})

it("rejects a relation outside its schema, also in a nested query, even of the same keys", () => {
  const commented = defineTable("commented", {
    id: t.uuid,
    postId: t.uuid,
  })
  const blog = defineSchema({ post, commented }).$relations({
    post: {
      comments: many(commented, { from: "id", to: "postId" }),
    },
  })
  const other = defineSchema({ post, commented }).$relations({
    post: {
      comments: many(commented, { from: "id", to: "postId" }),
    },
  })
  const db = createDatabase({ driver: createRecordingDriver().driver }).bind(blog)
  const query = other.post.select(post => ({
    comments: post.comments,
  }))
  const nested = blog.post.select(post => ({
    nested: post.comments.select(() => ({
      comments: query,
    })),
  }))
  const error = 'Relation "post.comments" is not part of the schema'

  expect(() => db.$compile(query)).toThrow(error)
  expect(() => db.$compile(nested)).toThrow(error)
  expect(
    db.$compile(
      blog.post.select(post => ({
        comments: post.comments,
      })),
    ).text,
  ).toContain('FROM "commented" AS "commented" WHERE "commented"."postId" = "post"."id"')
})

it("compiles a nested query bound to it into the statement of its parent", () => {
  const { db } = connectRecorded()
  const query = db.post.select(post => ({
    sameTitle: db.post.where(other => other.title.eq(post.title)).pluck("id"),
  }))

  expect(db.$compile(query).text).toContain(
    'FROM "app"."post" AS "post_2" WHERE "post_2"."title" = "post"."title") AS "subquery") AS "sameTitle" FROM "app"."post" AS "post"',
  )
})

it("rejects a query bound to another Db, also in a nested query", () => {
  const { db } = connectRecorded()
  const { db: otherDb } = connectRecorded()
  const nested = otherDb.post.select(() => ({
    ids: db.post.pluck("id"),
  }))

  expect(() => otherDb.$compile(db.post)).toThrow("Cannot run a query bound to another Db")
  expect(() => otherDb.$compile(nested)).toThrow('Selected field "ids" is bound to another Db')
})

it("rejects a query of $select bound to another Db, or of a table outside its schema", () => {
  const { db } = connectRecorded()
  const { db: otherDb } = connectRecorded()
  const comments = schema.$select({
    comments: from(comment),
  })

  expect(() => otherDb.$compile(db.$select({}))).toThrow("Cannot run a query bound to another Db")
  expect(() => db.$compile(comments)).toThrow('Table "comment" is not part of the schema')
})
