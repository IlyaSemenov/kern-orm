// Time of the public drivers processing prepared client results, without PostgreSQL, wire parsing, or network latency.
// Empty results isolate per-column metadata work; a query of one record also measures looking up result columns by name.
// Client metadata and values are prepared outside the timed calls, as they are before the adapter receives a result.

import assert from "node:assert/strict"

import { createDatabase } from "kern-orm"
import { text } from "kern-orm/types"

import { createResultDriver } from "./driver-fixture.ts"
import type { Topic } from "./scenario.ts"

const driverResults: Topic = {}
for (const client of ["node-postgres", "postgres.js"] as const) {
  for (const width of [0, 1, 16, 128]) {
    driverResults[`${client}: ${width} columns, no rows`] = async () => {
      const driver = createResultDriver(client, width, [])
      const statement = { text: "SELECT", parameters: [] }
      const result = await driver.execute(statement)
      assert.equal(result.columns.length, width)
      assert.deepEqual(result.rows, [])
      return () => driver.execute(statement)
    }
  }
  driverResults[`${client}: decode 16 columns, one row`] = async () => {
    const values = Array.from({ length: 16 }, (_, index) => String(index))
    const driver = createResultDriver(client, values.length, [values])
    const database = createDatabase({ driver })
    const fields: Record<string, typeof text> = {}
    const expected: Record<string, string> = {}
    for (let index = 0; index < values.length; index++) {
      fields[`c${index}`] = text
      expected[`c${index}`] = values[index]!
    }
    const query = database.query`SELECT`.select(fields)
    assert.deepEqual(await query, [expected])
    // Return a promise, since the worker detects async scenarios by Promise rather than by thenables.
    return () => query.then()
  }
}

export default driverResults
