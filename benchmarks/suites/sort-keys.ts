// Packed nested rows aggregated by a sort key projected from their derived source, which packing does, against numbering the rows with `row_number()` in the derived source and aggregating by the number: time in PostgreSQL.

import { measureExecution, runBenchmark } from "../harness"
import { createNestedTables, packRow, selectNested, selectParents } from "../nested-rows"

await runBenchmark(async run => {
  for (const table of await createNestedTables(run)) {
    const { fields } = table
    const columns = fields.map(field => `c.${field.name}`)
    const row = packRow(fields)
    const variants = [
      {
        name: "sort key",
        nested: selectNested(table, ["c.position", ...columns]),
        order: "s.position",
      },
      {
        name: "row number",
        nested: selectNested(table, [
          "row_number() OVER (ORDER BY c.position) AS number",
          ...columns,
        ]),
        order: "s.number",
      },
    ]
    for (const { name, nested, order } of variants) {
      const execution = await measureExecution(run, selectParents(nested, row, order))
      console.log(
        `${fields.length} fields, ${name.padEnd(10)}: PostgreSQL ${execution.toFixed(1)} ms`,
      )
    }
  }
})
