import { expect, it } from "bun:test"

import { describePostgres } from "@kern-orm/test-harness/postgres"

import { param } from "../../sql/fragment"

import { boolean } from "./boolean"
import { jsonb } from "./json"

describePostgres("in PostgreSQL", ({ database, testTransaction }) => {
  it("tells a JSON null value from NULL through a type that gives the JSON null value a value of its own", () =>
    testTransaction(async () => {
      const jsonNull = Symbol("JSON null")
      type Payload = { url?: string }
      // The type of "JSON null values" of the Types page of the Database group.
      const payloadType = jsonb.of<Payload>().transform({
        decode: (value): Payload | typeof jsonNull => (value === null ? jsonNull : value),
        encode: (value: Payload | typeof jsonNull) =>
          value === jsonNull ? (null as never) : value,
      })
      await database.script`CREATE TABLE job (id integer, payload jsonb)`
      await database.query`
        INSERT INTO job (id, payload) VALUES
          (1, ${param(payloadType, jsonNull)}),
          (2, ${param(payloadType.nullable(), null)}),
          (3, ${param(payloadType, { url: "/a" })})
      `

      const payloads = await database.query`SELECT payload FROM job ORDER BY id`.pluck(
        payloadType.nullable(),
      )
      expect(payloads).toEqual([jsonNull, null, { url: "/a" }])
      expect(
        await database.query`SELECT payload IS NULL FROM job ORDER BY id`.pluck(boolean),
      ).toEqual([false, true, false])
    }))
})
