import { describe, expect, it } from "bun:test"

import { createRecordingDriver } from "../../testing/recording-driver"
import { createSubquery } from "../ast/testing"
import { identifier, sql } from "../expression/sql"
import { lower } from "../lowering/testing"
import type { AnySelectQuery } from "../query/select"
import { from, SelectQuery } from "../query/select"
import { NotFoundError } from "../result/result"
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

it("executes a script of a template that interpolates a name from identifier", async () => {
  const { db, scripts } = connectRecorded()

  await db.$script`ANALYZE ${identifier("comment")}`

  expect(scripts).toEqual([{ connection: "pool", script: 'ANALYZE "comment"' }])
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

it("takes an advisory lock in a transaction of the database with $lock", async () => {
  const { db, statements } = connectRecorded()

  await db.$transaction(() => db.$lock("import"))

  expect(statements).toMatchObject([
    { text: "BEGIN" },
    { text: "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", parameters: ["import"] },
    { text: "COMMIT" },
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
