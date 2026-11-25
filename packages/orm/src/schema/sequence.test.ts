import { describe, expect, it } from "bun:test"

import { getThrownError } from "@kern-orm/test-harness/errors"
import { createRecordingDriver } from "@kern-orm/test-harness/recording-driver"
import { createDatabase } from "kern-db"

import { describePostgres } from "../../testing/postgres"
import { bindSchema } from "../execution/db"
import { param, sql } from "../expression/sql"
import { defineTable } from "../table/table"
import * as t from "../types"

import { defineSchema } from "./schema"
import { defineSequence, SequenceReference } from "./sequence"

const job = defineTable("job", {
  id: t.integer.primaryKey(),
  claim: t.bigint.nullable(),
})
const claimSeq = defineSequence("claim_seq")
const schema = defineSchema({ job, claimSeq })

function bindRecorded(schemaName?: string | (() => string)) {
  const { driver, scripts } = createRecordingDriver()
  const db = bindSchema(schema, createDatabase({ driver }), { schemaName })
  return { db, scripts }
}

it("is a frozen descriptor of its name", () => {
  expect(claimSeq).toEqual({ kind: "sequence", name: "claim_seq" })
  expect(Object.isFrozen(claimSeq)).toBe(true)
})

it("rejects an empty name", () => {
  expect(getThrownError(() => defineSequence(""))).toEqual(
    new TypeError("defineSequence() takes the name of a sequence as a non-empty string"),
  )
})

describe("names", () => {
  it("names the sequence in the PostgreSQL schema of the Db", () => {
    const { db } = bindRecorded("tenant")

    expect(db.$query`SELECT last_value FROM ${db.claimSeq}`.toSQL()).toEqual({
      text: 'SELECT last_value FROM "tenant"."claim_seq"',
      parameters: [],
    })
  })

  it("resolves the PostgreSQL schema of a function when the statement compiles", () => {
    let tenant = "tenant_1"
    const { db } = bindRecorded(() => tenant)
    const query = db.$query`ALTER SEQUENCE ${db.claimSeq} RESTART`

    tenant = "tenant_2"

    expect(query.toSQL().text).toBe('ALTER SEQUENCE "tenant_2"."claim_seq" RESTART')
  })

  it("leaves the name unqualified without a PostgreSQL schema", () => {
    const { db } = bindRecorded()

    expect(db.$query`SELECT last_value FROM ${db.claimSeq}`.toSQL().text).toBe(
      'SELECT last_value FROM "claim_seq"',
    )
  })

  it("names a sequence of the schema in the PostgreSQL schema of the Db that runs the statement", () => {
    const { db } = bindRecorded("tenant")

    expect(db.$query`SELECT last_value FROM ${schema.claimSeq}`.toSQL().text).toBe(
      'SELECT last_value FROM "tenant"."claim_seq"',
    )
  })

  it("interpolates into a script, which has no parameters", async () => {
    const { db, scripts } = bindRecorded("tenant")

    await db.$script`ALTER SEQUENCE ${db.claimSeq} RESTART WITH 10; SELECT ${db.claimSeq.nextval()}`

    expect(scripts).toEqual([
      {
        connection: "pool",
        script: `ALTER SEQUENCE "tenant"."claim_seq" RESTART WITH 10; SELECT nextval('"tenant"."claim_seq"'::regclass)`,
      },
    ])
  })
})

describe("functions", () => {
  it("passes the sequence to its functions as a regclass constant of its name", () => {
    const { db } = bindRecorded("tenant")

    expect(
      db.$query`SELECT ${db.claimSeq.nextval()}, ${db.claimSeq.currval()}, ${db.claimSeq.setval(10)}, ${db.claimSeq.setval(10n, false)}`.toSQL(),
    ).toEqual({
      text: `SELECT nextval('"tenant"."claim_seq"'::regclass), currval('"tenant"."claim_seq"'::regclass), setval('"tenant"."claim_seq"'::regclass, $1), setval('"tenant"."claim_seq"'::regclass, $2, FALSE)`,
      parameters: ["10", "10"],
    })
  })

  it("quotes a name with quotes and backslashes in its constant", () => {
    const quoted = defineSequence(`it's\\seq`)
    const db = bindSchema(
      defineSchema({ quoted }),
      createDatabase({ driver: createRecordingDriver().driver }),
      { schemaName: 'te"nant' },
    )

    expect(db.$query`SELECT ${db.quoted.nextval()}`.toSQL().text).toBe(
      `SELECT nextval(E'"te""nant"."it''s\\\\seq"'::regclass)`,
    )
  })

  it("sets a column of an update to the next value", () => {
    const { db } = bindRecorded("tenant")

    expect(db.$compile(db.job.find(1).update({ claim: db.claimSeq.nextval() }))).toEqual({
      text: `UPDATE "tenant"."job" AS "job" SET "claim" = nextval('"tenant"."claim_seq"'::regclass) WHERE "job"."id" = $1`,
      parameters: ["1"],
    })
  })

  it("takes an expression as the value of setval", () => {
    const { db } = bindRecorded()

    const query = db.job.select(row => ({
      value: db.claimSeq.setval(sql`${row.id} * 10`),
    }))

    expect(db.$compile(query)).toMatchObject({
      text: `SELECT setval('"claim_seq"'::regclass, "job"."id" * 10) AS "value" FROM "job" AS "job"`,
    })
  })

  it("rejects a value of setval that is null or undefined", () => {
    const { db } = bindRecorded()

    // @ts-expect-error A sequence has no NULL value.
    expect(getThrownError(() => db.claimSeq.setval(null))).toEqual(
      new TypeError("setval takes a value other than null"),
    )
    // @ts-expect-error A sequence has no NULL value.
    expect(getThrownError(() => db.claimSeq.setval(undefined))).toEqual(
      new TypeError("setval takes a value other than undefined"),
    )
  })

  it("rejects isCalled that is not a Boolean", () => {
    const { db } = bindRecorded()

    // @ts-expect-error isCalled is a Boolean.
    expect(getThrownError(() => db.claimSeq.setval(1, param(t.boolean, true)))).toEqual(
      new TypeError("setval() takes isCalled as a Boolean"),
    )
  })
})

describe("Db", () => {
  it("binds the sequences of a Db to it", () => {
    const { db } = bindRecorded()

    expect(db.claimSeq).toBeInstanceOf(SequenceReference)
    expect(db.claimSeq.sequence).toBe(claimSeq)
    expect(db.claimSeq.db).toBe(db)
    expect(schema.claimSeq.db).toBeUndefined()
    expect(db.$schema.$sequences).toEqual({ claimSeq })
  })

  it("rejects a sequence bound to another Db, by its name and in its functions", () => {
    const { db } = bindRecorded("tenant")
    const other = bindRecorded("other").db

    expect(
      getThrownError(() => db.$query`SELECT last_value FROM ${other.claimSeq}`.toSQL()),
    ).toEqual(new Error('Sequence "claim_seq" is bound to another Db'))
    expect(
      getThrownError(() => db.$compile(db.job.find(1).update({ claim: other.claimSeq.nextval() }))),
    ).toEqual(new Error('Sequence "claim_seq" is bound to another Db'))
  })

  it("rejects a sequence bound to a Db in a query that no Db compiles", () => {
    const { db } = bindRecorded()

    expect(
      getThrownError(() => schema.job.find(1).update({ claim: db.claimSeq.nextval() }).toSQL()),
    ).toEqual(
      new Error('Sequence "claim_seq" is bound to a Db, so only that Db can compile the query'),
    )
  })

  it("rejects a sequence of another schema", () => {
    const { db } = bindRecorded()
    const other = defineSchema({ claimSeq: defineSequence("claim_seq") })

    expect(getThrownError(() => db.$query`SELECT ${other.claimSeq.nextval()}`.toSQL())).toEqual(
      new Error('Sequence "claim_seq" is not part of the schema'),
    )
  })
})

describePostgres("in PostgreSQL", ({ database, testTransaction, useTestFixture }) => {
  const schemaName = 'Tenant "1"'

  useTestFixture(() =>
    database.script(`
      CREATE SCHEMA "Tenant ""1""";
      CREATE TABLE "Tenant ""1""".job (id integer PRIMARY KEY, claim bigint);
      INSERT INTO "Tenant ""1""".job VALUES (1, NULL), (2, NULL);
      CREATE SEQUENCE "Tenant ""1""".claim_seq START WITH 100;
    `),
  )

  const db = bindSchema(schema, database, { schemaName })

  it("runs the functions of the sequence in the PostgreSQL schema of the Db", () =>
    testTransaction(async () => {
      expect(await db.$query`SELECT ${db.claimSeq.nextval()} AS value`.get(t.bigint)).toBe(100n)
      expect(await db.$queryOn(database)`SELECT ${db.claimSeq.currval()}`.get(t.bigint)).toBe(100n)

      await db.job.find(2).update({ claim: db.claimSeq.nextval() })

      expect(await db.job.find(2).get("claim")).toBe(101n)
      expect(
        await db.$select({
          value: db.claimSeq.setval(10, false),
        }),
      ).toEqual({ value: 10n })
      expect(await db.$query`SELECT last_value FROM ${db.claimSeq}`.get(t.bigint)).toBe(10n)
      expect(
        await db.$select({
          value: db.claimSeq.nextval(),
        }),
      ).toEqual({ value: 10n })
      // `setval` of NULL leaves the sequence unchanged and gives NULL.
      expect(
        await db.job.find(1).select(row => ({
          value: db.claimSeq.setval(row.claim),
        })),
      ).toEqual({ value: null })
      expect(await db.$query`SELECT last_value FROM ${db.claimSeq}`.get(t.bigint)).toBe(10n)
    }))
})
