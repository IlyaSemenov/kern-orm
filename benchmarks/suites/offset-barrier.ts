// The derived source of packed nested rows without and with `OFFSET 0`: time in PostgreSQL for a source of table columns, which packing leaves without the barrier, and for a source of other expressions, which packing gives it.
// Without the barrier, PostgreSQL merges the source into the aggregating query and can evaluate an expression of a packed value twice; the expressions are `md5` of the columns.

import { measureExecution, runBenchmark } from "../harness"
import { createNestedTables, packRow, selectNested, selectParents } from "../nested-rows"

await runBenchmark(async run => {
  for (const table of await createNestedTables(run)) {
    const { fields } = table
    const row = packRow(fields)
    const sources = [
      { name: "columns", projections: fields.map(field => `c.${field.name}`) },
      {
        name: "expressions",
        projections: fields.map(field => `md5(c.${field.name}::text) AS ${field.name}`),
      },
    ]
    for (const { name, projections } of sources) {
      const times: number[] = []
      for (const suffix of [undefined, "OFFSET 0"]) {
        const nested = selectNested(table, ["c.position", ...projections], suffix)
        times.push(await measureExecution(run, selectParents(nested, row, "s.position")))
      }
      console.log(
        `${fields.length} fields, ${name.padEnd(11)}: PostgreSQL ${times[0]!.toFixed(1)} ms without OFFSET 0, ${times[1]!.toFixed(1)} ms with it`,
      )
    }
  }
})
