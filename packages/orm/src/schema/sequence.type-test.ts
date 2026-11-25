import { describe, expectTypeOf, test } from "bun:test"

import { createRecordingDriver } from "@kern-orm/test-harness/recording-driver"
import { createDatabase } from "kern-db"

import type { DbOf } from "../execution/db"
import { bindSchema } from "../execution/db"
import { coalesce } from "../expression/functions"
import { sql } from "../expression/sql"
import type { SelectQuery } from "../query/select"
import type { EmptyRecord, InitialQueryState } from "../query/state"
import { defineTable } from "../table/table"
import * as t from "../types"

import type { SchemaObjects } from "./schema"
import { defineSchema } from "./schema"
import type { Sequence, SequenceReference, SequenceValue } from "./sequence"
import { defineSequence } from "./sequence"

const job = defineTable("job", {
  id: t.integer.primaryKey(),
  claim: t.bigint.nullable(),
})
const claimSeq = defineSequence("claim_seq")
const schema = defineSchema({ job, claimSeq })
const db = bindSchema(schema, createDatabase({ driver: createRecordingDriver().driver }))

describe("defineSequence", () => {
  test("keeps the name of the sequence", () => {
    expectTypeOf(claimSeq).toEqualTypeOf<Sequence<"claim_seq">>()
  })
})

describe("schemas", () => {
  test("keep the sequences of a part apart from its tables", () => {
    expectTypeOf(schema.$tables).toEqualTypeOf<{ job: typeof job }>()
    expectTypeOf(schema.$sequences).toEqualTypeOf<{ claimSeq: typeof claimSeq }>()
    expectTypeOf(schema.job).toEqualTypeOf<SelectQuery<InitialQueryState<typeof job>>>()
    expectTypeOf(schema.claimSeq).toEqualTypeOf<SequenceReference<typeof claimSeq>>()
  })

  test("include the sequences of other schemas and keep them with added relations", () => {
    const other = defineTable("other", {
      id: t.uuid,
    })
    const composed = defineSchema(schema, { other })
    const related = composed.$relations({})

    expectTypeOf(composed.$sequences).toEqualTypeOf<{ claimSeq: typeof claimSeq }>()
    expectTypeOf(related.$sequences).toEqualTypeOf<{ claimSeq: typeof claimSeq }>()
  })

  test("give the tables and the sequences of known kinds of a part whose other keys may be of either kind", () => {
    const other = defineTable("other", {
      id: t.uuid,
    })
    const pick = (flag: boolean) => defineSchema({ job, claimSeq, either: flag ? other : claimSeq })
    const parts: SchemaObjects = { claimSeq }

    expectTypeOf(pick(true).$tables).toEqualTypeOf<{ job: typeof job }>()
    expectTypeOf(pick(true).$sequences).toEqualTypeOf<{ claimSeq: typeof claimSeq }>()
    expectTypeOf(defineSchema(parts).$tables).toEqualTypeOf<EmptyRecord>()
    expectTypeOf(defineSchema(parts).$sequences).toEqualTypeOf<EmptyRecord>()
  })

  test("have no sequences without them", () => {
    expectTypeOf(defineSchema({ job }).$sequences).toEqualTypeOf<EmptyRecord>()
  })
})

describe("Db", () => {
  test("has the sequences of its schema", () => {
    expectTypeOf(db.claimSeq).toEqualTypeOf<SequenceReference<typeof claimSeq>>()
  })

  test("serves as a Db of a schema only when it has the sequences of the schema", () => {
    const jobDb: DbOf<typeof schema> = bindSchema(defineSchema(schema, {}), db.$database)
    // @ts-expect-error The schema lacks the sequence.
    const plainDb: DbOf<typeof schema> = bindSchema(defineSchema({ job }), db.$database)
    void [jobDb, plainDb]
  })
})

describe("functions", () => {
  test("give expressions of bigint values", () => {
    expectTypeOf(db.claimSeq.nextval()).toEqualTypeOf<SequenceValue>()
    expectTypeOf(db.claimSeq.currval()).toEqualTypeOf<SequenceValue>()
    expectTypeOf(db.claimSeq.setval(1n, false)).toEqualTypeOf<SequenceValue>()
  })

  test("select bigint values and set bigint columns", async () => {
    expectTypeOf(
      await db.$select({
        value: db.claimSeq.nextval(),
      }),
    ).toEqualTypeOf<{
      value: bigint
    }>()
    void db.job.find(1).update({ claim: db.claimSeq.nextval() })
  })

  test("give a nullable value of setval of a nullable operand", () => {
    void db.job.select(row => {
      expectTypeOf(db.claimSeq.setval(row.claim)).toEqualTypeOf<SequenceValue<bigint | null>>()
      expectTypeOf(db.claimSeq.setval(coalesce(row.claim, 0n))).toEqualTypeOf<SequenceValue>()
      return {
        id: row.id,
      }
    })
  })

  test("take a value of setval as a number, a bigint, or an expression of bigint values", () => {
    void db.claimSeq.setval(1)
    void db.claimSeq.setval(db.claimSeq.currval())
    // @ts-expect-error A value of a sequence is a number.
    void db.claimSeq.setval("1")
    // @ts-expect-error setval of PostgreSQL takes no floating-point value.
    void db.claimSeq.setval(sql(t.doublePrecision)`1.5`)
  })
})
