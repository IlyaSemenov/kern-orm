import { describe, expectTypeOf, test } from "bun:test"

import { createRecordingDriver } from "@kern-orm/test-harness/recording-driver"
import type { SqlColumns } from "kern-db"
import { createDatabase } from "kern-db"

import { bindSchema } from "../execution/db"
import { defineSchema } from "../schema/schema"
import type { AnyTable, Selectable } from "../table/table"
import { defineTable, defineView } from "../table/table"
import * as t from "../types"

import { columnsOf } from "./columns-of"

const job = defineTable("job", {
  id: t.integer.primaryKey(),
  task: t.text,
  lockedBy: t.text.nullable(),
})

const membership = defineTable(
  "membership",
  {
    userId: t.integer,
    teamId: t.integer,
    role: t.text,
  },
  { primaryKey: ["userId", "teamId"] },
)

const pendingJob = defineView("pending_job", {
  id: t.integer,
  note: t.text.nullable(),
})

const event = defineView("event", {
  payload: t.jsonb,
  seenAt: t.text.transform({ decode: (value): string | undefined => value || undefined }),
  note: t.text.nullable(),
})

const db = bindSchema(
  defineSchema({ job, membership }),
  createDatabase({ driver: createRecordingDriver().driver }),
)

describe("columns", () => {
  test('of "*" are of the record of the table, of a table of a Db or of its definition', () => {
    expectTypeOf(columnsOf(db.job, "*")).toEqualTypeOf<
      SqlColumns<{ id: number; task: string; lockedBy: string | null }, true>
    >()
    expectTypeOf(columnsOf(job, "*")).toEqualTypeOf(columnsOf(db.job, "*"))
    expectTypeOf<Selectable<typeof job>>().toEqualTypeOf<{
      id: number
      task: string
      lockedBy: string | null
    }>()
  })

  test('require the columns to select, "*" for all of them', () => {
    // @ts-expect-error The columns are selected explicitly, "*" for all of them.
    columnsOf(db.job)
  })

  test("reject an object that is neither a table nor a query of one", () => {
    // @ts-expect-error An object of a table is not a query of it.
    columnsOf({ table: job }, "*")
  })

  test("of a list of keys are of the record of those columns, and reject another key", () => {
    expectTypeOf(columnsOf(db.job, ["task", "id"])).toEqualTypeOf<
      SqlColumns<{ id: number; task: string }, true>
    >()
    // @ts-expect-error The table has no such column.
    columnsOf(db.job, ["name"])
  })

  test("of a list of keys take a list of a type parameter of a function that passes it on", () => {
    /** Returns the columns of a job of keys `columns`. */
    function createJobColumns<const C extends readonly ("id" | "task")[]>(columns: C) {
      return columnsOf(db.job, columns)
    }
    const keys: ("id" | "task")[] = []

    expectTypeOf(createJobColumns(["id", "task"])).toEqualTypeOf<
      SqlColumns<{ id: number; task: string }, true>
    >()
    expectTypeOf(createJobColumns(keys)).toEqualTypeOf<
      SqlColumns<{ id?: number; task?: string }, false>
    >()
  })

  test("of keys of a list that the list does not guarantee are optional, as of select by keys, and include the primary key only when guaranteed", () => {
    const key = Math.random() < 0.5 ? "id" : "task"
    const tasks: "task"[] = []
    const keys: ("id" | "task")[] = []

    expectTypeOf(columnsOf(db.job, [key])).toEqualTypeOf<
      SqlColumns<{ id?: number; task?: string }, false>
    >()
    expectTypeOf(columnsOf(db.job, keys)).toEqualTypeOf<
      SqlColumns<{ id?: number; task?: string }, false>
    >()
    expectTypeOf(columnsOf(db.job, ["id", ...tasks])).toEqualTypeOf<
      SqlColumns<{ id: number; task?: string }, true>
    >()
    expectTypeOf(
      columnsOf(db.job, Math.random() < 0.5 ? (["id"] as const) : (["task"] as const)),
    ).toEqualTypeOf<SqlColumns<{ id: number } | { task: string }, false>>()
    // @ts-expect-error A list that may leave out the primary key takes the columns in `by`.
    columnsOf(db.job, [key]).nullable()
    // @ts-expect-error A column that the list does not guarantee does not tell a missing row.
    columnsOf(db.job, ["id", ...tasks]).nullable({ by: ["task"] })
  })

  test('of a union of "*" and a list are a union of their records, and include the primary key only when each does', () => {
    const all = Math.random() < 0.5
    const withId = all ? "*" : (["id"] as const)
    const withoutId = all ? "*" : (["task"] as const)

    expectTypeOf(columnsOf(db.job, withId)).toEqualTypeOf<
      SqlColumns<{ id: number; task: string; lockedBy: string | null } | { id: number }, true>
    >()
    expectTypeOf(columnsOf(db.job, withoutId)).toEqualTypeOf<
      SqlColumns<{ id: number; task: string; lockedBy: string | null } | { task: string }, false>
    >()
  })

  test("tell whether they include the primary key, which nullable needs unless it takes the columns in by", () => {
    expectTypeOf(columnsOf(db.job, ["task"])).toEqualTypeOf<SqlColumns<{ task: string }, false>>()
    expectTypeOf(columnsOf(membership, ["userId", "role"])).toEqualTypeOf<
      SqlColumns<{ userId: number; role: string }, false>
    >()
    expectTypeOf(columnsOf(pendingJob, "*")).toEqualTypeOf<
      SqlColumns<{ id: number; note: string | null }, false>
    >()
    expectTypeOf(columnsOf(db.job, "*").nullable()).toEqualTypeOf<
      SqlColumns<{ id: number; task: string; lockedBy: string | null } | null, true>
    >()
    expectTypeOf(columnsOf(pendingJob, "*").nullable({ by: ["id"] })).toEqualTypeOf<
      SqlColumns<{ id: number; note: string | null } | null, false>
    >()
    // @ts-expect-error Columns without their key take the columns in `by`.
    columnsOf(pendingJob, "*").nullable()
    // @ts-expect-error A column that can be `NULL` does not tell a missing row.
    columnsOf(pendingJob, "*").nullable({ by: ["note"] })
  })

  test("take in by a column that is not nullable whose values are unknown or may be undefined", () => {
    const columns = columnsOf(event, "*")

    columns.nullable({ by: ["payload", "seenAt"] })
    // @ts-expect-error A column that can be `NULL` does not tell a missing row.
    columns.nullable({ by: ["note"] })
  })

  test("of keys of a list typed as patterns are optional and include the primary key only by the keys typed as single keys", () => {
    const grant = defineTable(
      "grant",
      {
        userId: t.integer,
        teamId: t.integer,
        role: t.integer,
      } as Record<string, typeof t.integer>,
      { primaryKey: ["userId", "teamId"] },
    )
    const slot = defineTable(
      "slot",
      {
        key1: t.integer,
        key2: t.integer,
        key3: t.integer,
      } as Record<`key${number}`, typeof t.integer>,
      { primaryKey: ["key1", "key2"] },
    )
    const tenantSlot = defineTable(
      "tenant_slot",
      {
        tenant: t.integer,
        key1: t.integer,
        key3: t.integer,
      } as Record<"tenant" | `key${number}`, typeof t.integer>,
      { primaryKey: ["tenant", "key1"] },
    )
    const key: string = "role"
    const keys: string[] = []
    const slotKey: `key${number}` = "key3"

    expectTypeOf(columnsOf(grant, "*").nullable()).toEqualTypeOf<
      SqlColumns<{ [key: string]: number } | null, true>
    >()
    expectTypeOf(columnsOf(grant, ["userId", "teamId", key])).toEqualTypeOf<
      SqlColumns<{ [key: string]: number | undefined; userId: number; teamId: number }, true>
    >()
    expectTypeOf(columnsOf(grant, [key]).nullable({ by: [key] })).toEqualTypeOf<
      SqlColumns<{ [key: string]: number | undefined } | null, false>
    >()
    expectTypeOf(columnsOf(grant, ["userId", ...keys])).toEqualTypeOf<
      SqlColumns<{ [key: string]: number | undefined; userId: number }, false>
    >()
    // @ts-expect-error A key typed as `string` may leave out the primary key, so `nullable` takes the columns in `by`.
    columnsOf(grant, [key]).nullable()

    // @ts-expect-error A key typed as a pattern may leave out the primary key, so `nullable` takes the columns in `by`.
    columnsOf(slot, [slotKey]).nullable()

    expectTypeOf(columnsOf(tenantSlot, ["tenant", "key1", slotKey]).hasKey).toEqualTypeOf<true>()
    expectTypeOf(columnsOf(tenantSlot, ["tenant", slotKey]).hasKey).toEqualTypeOf<false>()
  })

  test("of columns named as members of Object.prototype, such as toString, tell their keys as single keys", () => {
    const named = defineTable("named", {
      toString: t.integer.primaryKey(),
      valueOf: t.text,
    })
    const member = Math.random() < 0.5 ? "toString" : "valueOf"

    expectTypeOf(columnsOf(named, ["toString"]).nullable()).toEqualTypeOf<
      SqlColumns<{ toString: number } | null, true>
    >()
    expectTypeOf(columnsOf(named, [member])).toEqualTypeOf<
      SqlColumns<{ toString?: number; valueOf?: string }, false>
    >()
  })

  test("of a table whose type does not tell its keys take nullable with or without by", () => {
    const columns = columnsOf(job as AnyTable, "*")

    expectTypeOf(columns.nullable()).toEqualTypeOf(columns.nullable({ by: ["id"] }))
  })

  test("are records of select of a query of SQL text, null of nullable", async () => {
    const rows = await db.$query`SELECT`.select({
      job: columnsOf(db.job, ["id"]),
      membership: columnsOf(membership, "*").nullable(),
      lag: t.integer,
    })

    expectTypeOf(rows).toEqualTypeOf<
      {
        job: { id: number }
        membership: { userId: number; teamId: number; role: string } | null
        lag: number
      }[]
    >()
  })
})
