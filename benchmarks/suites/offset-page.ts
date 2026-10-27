// Nested rows of a page after an offset selected as scalar subqueries of the parent query, against the same subqueries over a derived source of the page, which lowering builds: time in PostgreSQL for a page of 20 parents after offsets of 0, 100, and 900, ordered by an indexed and by an unindexed column.
// PostgreSQL evaluates the select list for the rows that the offset skips as well, while over a derived source of the page it evaluates it only for the rows of the page.

import { measureExecution, runBenchmark } from "../harness"
import { createNestedTables, packRow, selectNested } from "../nested-rows"

await runBenchmark(async run => {
  const tables = await createNestedTables(run)
  // A column without an index, whose order differs from the order of the ids.
  await run("ALTER TABLE parent ADD COLUMN rank integer")
  await run("UPDATE parent SET rank = (id * 7919) % 100003")
  await run("ANALYZE parent")
  for (const table of tables) {
    const { fields } = table
    const nested = selectNested(table, ["c.position", ...fields.map(field => `c.${field.name}`)])
    const items = `(SELECT coalesce(json_agg(${packRow(fields)} ORDER BY s.position), '[]'::json) FROM (${nested}) AS s) AS items`
    for (const order of ["id", "rank"]) {
      for (const offset of [0, 100, 900]) {
        const page = `ORDER BY p.${order} LIMIT 20 OFFSET ${offset}`
        const plain = await measureExecution(run, `SELECT p.id, ${items} FROM parent AS p ${page}`)
        const derived = await measureExecution(
          run,
          `SELECT p.id, ${items} FROM (SELECT p.id, p.rank FROM parent AS p ${page}) AS p ORDER BY p.${order}`,
        )
        console.log(
          `${fields.length} fields, by ${order.padEnd(4)}, offset ${String(offset).padStart(3)}: PostgreSQL ${plain.toFixed(2)} ms over the parents, ${derived.toFixed(2)} ms over a derived page`,
        )
      }
    }
  }
})
