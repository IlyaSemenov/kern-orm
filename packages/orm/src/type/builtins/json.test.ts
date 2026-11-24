import { describe, expect, it } from "bun:test"

import { getThrownError } from "@kern-orm/test-harness/errors"
import type { JsonNull } from "kern-db"
import { jsonNull } from "kern-db"

import { param } from "../../expression/sql"
import { from } from "../../query/select"
import { defineTable } from "../../table/table"
import * as t from "../../types"

describe("jsonbWithJsonNull", () => {
  type Payload = { url?: string }
  const job = defineTable("job", {
    id: t.integer.primaryKey(),
    payload: t.jsonbWithJsonNull.of<Payload | JsonNull>().nullable().default(jsonNull),
  })

  it("writes the marker of a default and of a value as the JSON text null, and null as NULL", () => {
    expect(from(job).insert({ id: 1 }).toSQL()).toEqual({
      text: 'INSERT INTO "job" AS "job" ("id", "payload") VALUES ($1, $2)',
      parameters: ["1", "null"],
    })
    expect(from(job).insert({ id: 1, payload: null }).toSQL().parameters).toEqual(["1", null])
    expect(from(job).find(1).update({ payload: jsonNull }).toSQL()).toEqual({
      text: 'UPDATE "job" AS "job" SET "payload" = $1 WHERE "job"."id" = $2',
      parameters: ["null", "1"],
    })
  })

  it("compares with the marker as a parameter without a cast, and matches null with IS NULL", () => {
    expect(from(job).where({ payload: jsonNull }).toSQL()).toEqual({
      text: 'SELECT FROM "job" AS "job" WHERE "job"."payload" = $1',
      parameters: ["null"],
    })
    expect(from(job).where({ payload: null }).toSQL()).toEqual({
      text: 'SELECT FROM "job" AS "job" WHERE "job"."payload" IS NULL',
      parameters: [],
    })
  })

  it("rejects a value other than the marker that JSON writes as a top-level null when the statement compiles", () => {
    const query = from(job).where(() => param(t.jsonbWithJsonNull, Number.NaN).isNull())

    expect(getThrownError(() => query.toSQL())).toEqual(
      new TypeError(
        "Value serializes to a top-level JSON null; to store a JSON null value intentionally, pass jsonNull and include JsonNull in any declared shape",
      ),
    )
  })
})

describe("jsonb", () => {
  it("rejects the marker when the statement compiles", () => {
    const job = defineTable("job", {
      id: t.integer.primaryKey(),
      payload: t.jsonb,
    })

    const query = from(job).where({ payload: jsonNull })

    expect(getThrownError(() => query.toSQL())).toEqual(
      new TypeError(
        "Cannot encode jsonNull with this type; use jsonWithJsonNull or jsonbWithJsonNull to write a JSON null value",
      ),
    )
  })
})
