// Cost of resolving SQL result columns by name through the public query API.
// Empty results isolate lookup from per-row decoding; the row cases show how the once-per-result lookup contributes to decoding.
// The driver result is prepared outside the timed calls.

import assert from "node:assert/strict"

import type { Driver, DriverResult, TextValue } from "kern-orm"
import { createDatabase } from "kern-orm"
import { text } from "kern-orm/types"

import type { Topic } from "./scenario.ts"

const resultColumns: Topic = {}
const cases = [
  { width: 1, selected: 1, count: 0 },
  { width: 4, selected: 4, count: 0 },
  { width: 8, selected: 8, count: 0 },
  { width: 12, selected: 12, count: 0 },
  { width: 16, selected: 16, count: 0 },
  { width: 64, selected: 64, count: 0 },
  { width: 128, selected: 128, count: 0 },
  { width: 128, selected: 1, count: 0 },
  { width: 128, selected: 2, count: 0 },
  { width: 128, selected: 4, count: 0 },
  { width: 128, selected: 16, count: 0 },
  { width: 16, selected: 4, count: 0 },
  { width: 16, selected: 8, count: 0 },
  { width: 64, selected: 8, count: 0 },
  { width: 128, selected: 128, count: 1 },
  { width: 16, selected: 16, count: 100 },
]
for (const { width, selected, count } of cases) {
  resultColumns[`${selected} of ${width} columns, ${count} rows`] = async () => {
    const values = Array.from({ length: width }, (_, index) => String(index))
    const rows: TextValue[][] = Array.from({ length: count }, () => values)
    const result: DriverResult = {
      command: "SELECT",
      count,
      columns: values.map((_, index) => ({ name: `c${index}`, type: 25 })),
      rows,
    }
    let answer: DriverResult = {
      command: "SELECT",
      count: 1,
      columns: result.columns,
      rows: [values],
    }
    const reject = () => Promise.reject(new Error("Only statements are used by this benchmark"))
    const driver: Driver = {
      execute: () => Promise.resolve(answer),
      executeScript: reject,
      acquire: reject,
      close: async () => {},
    }
    const database = createDatabase({ driver })
    const fields: Record<string, typeof text> = {}
    const expected: Record<string, string> = {}
    // Select in reverse order and spread a subset over the result, so positional matches cannot hide incorrect lookups.
    for (let index = selected - 1; index >= 0; index--) {
      const column = Math.floor((index * width) / selected)
      fields[`c${column}`] = text
      expected[`c${column}`] = values[column]!
    }
    const query = database.query`SELECT`.select(fields)
    // Validate positions even for a timed result with no rows.
    assert.deepEqual(await query, [expected])
    answer = result
    assert.deepEqual(
      await query,
      Array.from({ length: count }, () => expected),
    )
    return () => query.then()
  }
}

export default resultColumns
