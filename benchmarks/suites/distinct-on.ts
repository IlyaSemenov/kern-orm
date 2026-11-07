// Nested rows of the first row of each group selected as scalar subqueries of the query of `DISTINCT ON`, against the same subqueries over a derived source of the first rows, which lowering builds: time in PostgreSQL for groups of 10 and of 50 parents, of all the first rows, of a page of 10 of them, and of a page of 10 after an offset of 10.
// Without a limit, PostgreSQL evaluates the select list for every row before `DISTINCT ON` removes all but the first row of each group, while over a derived source it evaluates it only for the first rows.

import { measureExecution, runBenchmark } from "../harness"
import { createNestedTables, packRow, selectNested } from "../nested-rows"

await runBenchmark(async run => {
  const tables = await createNestedTables(run)
  // Columns without an index: the group of a parent, and the order that chooses the first row of a group.
  await run(
    "ALTER TABLE parent ADD COLUMN small integer, ADD COLUMN large integer, ADD COLUMN rank integer",
  )
  await run("UPDATE parent SET small = id % 100, large = id % 20, rank = (id * 7919) % 100003")
  await run("ANALYZE parent")
  for (const table of tables) {
    const { fields } = table
    const nested = selectNested(table, ["c.position", ...fields.map(field => `c.${field.name}`)])
    const items = `(SELECT coalesce(json_agg(${packRow(fields)} ORDER BY s.position), '[]'::json) FROM (${nested}) AS s) AS items`
    for (const [group, size] of [
      ["small", 10],
      ["large", 50],
    ] as const) {
      for (const page of ["", " LIMIT 10", " LIMIT 10 OFFSET 10"]) {
        const order = `ORDER BY p.${group}, p.rank DESC`
        const plain = await measureExecution(
          run,
          `SELECT DISTINCT ON (p.${group}) p.id, ${items} FROM parent AS p ${order}${page}`,
        )
        const derived = await measureExecution(
          run,
          `SELECT p.id, ${items} FROM (SELECT DISTINCT ON (p.${group}) p.id, p.${group}, p.rank FROM parent AS p ${order}${page}) AS p ${order}`,
        )
        console.log(
          `${String(fields.length).padStart(2)} fields, groups of ${String(size).padStart(3)}, ${(page.trim() || "all").padEnd(18)}: PostgreSQL ${plain.toFixed(2)} ms over the rows, ${derived.toFixed(2)} ms over derived first rows`,
        )
      }
    }
  }
})
