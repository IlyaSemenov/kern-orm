// Packed nested rows selected as a scalar subquery of the parent, which lowering builds, against a LATERAL join of the same subquery: time in PostgreSQL for all parents, and for a page of 20 parents ordered by an indexed and by an unindexed column.
// PostgreSQL evaluates a scalar subquery of the select list after the sort and the limit of the parent, while it joins a LATERAL subquery to every row before them unless an index gives the order.

import { measureExecution, runBenchmark } from "../harness"
import { createNestedTables, packRow, selectNested } from "../nested-rows"

await runBenchmark(async run => {
  const tables = await createNestedTables(run)
  // A column without an index, whose order differs from the order of the ids.
  await run("ALTER TABLE parent ADD COLUMN rank integer")
  await run("UPDATE parent SET rank = (id * 7919) % 100003")
  await run("ANALYZE parent")
  const pages = [
    { name: "all parents", suffix: "" },
    { name: "page by id", suffix: " ORDER BY p.id LIMIT 20" },
    { name: "page by rank", suffix: " ORDER BY p.rank LIMIT 20" },
  ]
  for (const table of tables) {
    const { fields } = table
    const nested = selectNested(table, ["c.position", ...fields.map(field => `c.${field.name}`)])
    const rows = `SELECT coalesce(json_agg(${packRow(fields)} ORDER BY s.position), '[]'::json) AS items FROM (${nested}) AS s`
    for (const { name, suffix } of pages) {
      const scalar = await measureExecution(
        run,
        `SELECT p.id, (${rows}) AS items FROM parent AS p${suffix}`,
      )
      const lateral = await measureExecution(
        run,
        `SELECT p.id, l.items FROM parent AS p LEFT JOIN LATERAL (${rows}) AS l ON TRUE${suffix}`,
      )
      console.log(
        `${fields.length} fields, ${name.padEnd(12)}: PostgreSQL ${scalar.toFixed(2)} ms as a scalar subquery, ${lateral.toFixed(2)} ms as a LATERAL join`,
      )
    }
  }
})
