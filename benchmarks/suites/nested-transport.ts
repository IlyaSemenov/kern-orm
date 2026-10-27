// Packed nested rows as positional JSON arrays, which kern-orm builds, against JSON objects with keys: time in PostgreSQL, round trip, size, and parsing and decoding in JavaScript.
// Both are written by hand like the SQL that packing builds for a nested query of table columns.

import { measure, measureExecution, measureRoundTrip, runBenchmark } from "../harness"
import type { Field } from "../nested-rows"
import { createNestedTables, packRow, packValue, selectNested, selectParents } from "../nested-rows"

/** Decodes the arrays of packed rows of `texts` into records, reading the values of `fields` by position or by key, and returns the number of records. */
function decodeRows(texts: string[], fields: readonly Field[], positional: boolean): number {
  let count = 0
  for (const text of texts) {
    for (const row of JSON.parse(text) as Record<string | number, string | null>[]) {
      const record: Record<string, unknown> = {}
      for (let index = 0; index < fields.length; index++) {
        const { name, kind } = fields[index]!
        const value = row[positional ? index : name]
        record[name] = value === null || value === undefined ? null : kind.type.decode(value)
      }
      count++
    }
  }
  return count
}

await runBenchmark(async run => {
  for (const table of await createNestedTables(run)) {
    const { fields } = table
    const nested = selectNested(table, ["c.position", ...fields.map(field => `c.${field.name}`)])
    const variants = [
      { name: "array", row: packRow(fields) },
      {
        name: "object",
        row: `json_build_object(${fields.map(field => `'${field.name}', ${packValue(`s.${field.name}`)}`).join(", ")})`,
      },
    ]
    for (const { name, row } of variants) {
      const query = selectParents(nested, row, "s.position")
      const execution = await measureExecution(run, query)
      const { time, rows } = await measureRoundTrip(run, query)
      const texts = rows.map(values => values[1]!)
      const size = texts.reduce((sum, text) => sum + Buffer.byteLength(text), 0) / 1024 / 1024
      const parsing = measure(() => texts.map(text => JSON.parse(text)))
      const decoding = measure(() => decodeRows(texts, fields, name === "array"))
      console.log(
        `${fields.length} fields, ${name.padEnd(6)}: PostgreSQL ${execution.toFixed(1)} ms, round trip ${time.toFixed(1)} ms, ${size.toFixed(2)} MiB, JSON.parse ${parsing.toFixed(1)} ms, parsing and decoding ${decoding.toFixed(1)} ms`,
      )
    }
  }
})
