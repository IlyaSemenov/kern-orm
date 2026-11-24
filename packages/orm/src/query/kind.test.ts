import { describe, expect, it } from "bun:test"

import { createRecordingDriver } from "@kern-orm/test-harness/recording-driver"
import { createDatabase, QueryError } from "kern-db"

import { bindSchema } from "../execution/db"
import { sql } from "../expression/sql"
import { defineSchema } from "../schema/schema"
import { defineTable } from "../table/table"
import * as t from "../types"

const post = defineTable("post", {
  id: t.uuid,
  title: t.text,
})
const schema = defineSchema({ post })

const failure = new QueryError("division by zero", { code: "22012" })

/** `Db` over a recording driver that fails the statements that divide by zero with `failure`, and returns a row of one value with the others. */
function connectRecorded() {
  const { driver, statements } = createRecordingDriver({
    respond(statement) {
      if (statement.text.includes("/ 0")) {
        throw failure
      }
      return { rows: [["post-id"]] }
    },
  })
  return { db: bindSchema(schema, createDatabase({ driver })), statements }
}

type RecordedDb = ReturnType<typeof connectRecorded>["db"]

/** Bound queries of each class, whose statements succeed. */
function createQueries(db: RecordedDb) {
  return {
    select: db.post.pluck("id"),
    transformed: db.post.pluck("id").transform(ids => ids.length),
    record: db.$select({
      id: sql(t.text)`'x'`,
    }),
    mutation: db.post.insert({ id: "post-id", title: "First" }).get("id"),
  }
}

/** Bound queries of each class whose statements fail with `failure`. */
function createFailingQueries(db: RecordedDb) {
  const failing = sql(t.integer)`1 / 0`
  const posts = db.post.where(() => sql`${failing} = 1`)
  return {
    select: posts.pluck("id"),
    transformed: posts.pluck("id").transform(ids => ids.length),
    record: db.$select({
      id: failing,
    }),
    mutation: posts.delete(),
  }
}

/** Returns the rejection that `catch` handles. */
const returnError = (error: unknown) => error

describe("catch of a bound query", () => {
  it("executes the query once and resolves to its result, as awaiting it does", async () => {
    const { db, statements } = connectRecorded()
    const { select, transformed, record, mutation } = createQueries(db)

    expect(await select.catch(returnError)).toEqual(["post-id"])
    expect(await transformed.catch(returnError)).toBe(1)
    expect(await record.catch(returnError)).toEqual({ id: "post-id" })
    expect(await mutation.catch(returnError)).toBe("post-id")

    expect(statements).toHaveLength(4)
  })

  it("resolves to the result of its callback with the error of a statement that fails, and rejects with the error without a callback", async () => {
    const { db, statements } = connectRecorded()
    const { select, transformed, record, mutation } = createFailingQueries(db)

    expect(await select.catch(returnError)).toBe(failure)
    expect(await transformed.catch(returnError)).toBe(failure)
    expect(await record.catch(returnError)).toBe(failure)
    expect(await mutation.catch(returnError)).toBe(failure)
    await expect(select.catch()).rejects.toBe(failure)

    expect(statements).toHaveLength(5)
  })
})

describe("finally of a bound query", () => {
  it("executes the query once, calls its callback, and passes on the result of the query", async () => {
    const { db, statements } = connectRecorded()
    const { select, transformed, record, mutation } = createQueries(db)
    let settled = 0
    const count = () => {
      settled++
    }

    expect(await select.finally(count)).toEqual(["post-id"])
    expect(await transformed.finally(count)).toBe(1)
    expect(await record.finally(count)).toEqual({ id: "post-id" })
    expect(await mutation.finally(count)).toBe("post-id")

    expect(settled).toBe(4)
    expect(statements).toHaveLength(4)
  })

  it("rejects with the error of its callback, also of an async one, for a query that resolves", async () => {
    const { db } = connectRecorded()
    const { select } = createQueries(db)
    const cleanupFailure = new Error("Cleanup failed")

    await expect(
      select.finally(() => {
        throw cleanupFailure
      }),
    ).rejects.toBe(cleanupFailure)
    await expect(
      select.finally(async () => {
        throw cleanupFailure
      }),
    ).rejects.toBe(cleanupFailure)
  })

  it("calls its callback and rejects with the error of a statement that fails", async () => {
    const { db, statements } = connectRecorded()
    const { select, transformed, record, mutation } = createFailingQueries(db)
    let settled = 0
    const count = () => {
      settled++
    }

    await expect(select.finally(count)).rejects.toBe(failure)
    await expect(transformed.finally(count)).rejects.toBe(failure)
    await expect(record.finally(count)).rejects.toBe(failure)
    await expect(mutation.finally(count)).rejects.toBe(failure)

    expect(settled).toBe(4)
    expect(statements).toHaveLength(4)
  })
})

describe("catch and finally", () => {
  it("execute the query again with each call, as each await does", async () => {
    const { db, statements } = connectRecorded()
    const { select } = createQueries(db)

    await select.catch(returnError)
    await select.finally()
    await select

    expect(statements).toHaveLength(3)
  })

  it("run the query in the ambient transaction", async () => {
    const { db, statements } = connectRecorded()
    const { select } = createQueries(db)

    await db.$transaction(async () => {
      await select.catch(returnError)
      await select.finally()
    })

    expect(statements.map(statement => statement.connection)).toEqual([1, 1, 1, 1])
  })

  it("are undefined for an unbound query of each class, as its then is", () => {
    const posts = schema.post.where({ id: "post-id" })
    const unbound = [
      posts.pluck("id"),
      posts.pluck("id").transform(ids => ids.length),
      schema.$select({}),
      posts.delete(),
    ]

    for (const query of unbound) {
      expect(query.then).toBeUndefined()
      expect(query.catch).toBeUndefined()
      expect(query.finally).toBeUndefined()
    }
  })
})
