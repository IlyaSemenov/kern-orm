// Nested rows of groups selected as scalar subqueries of the query of `GROUP BY`, against the same subqueries over a derived source of the groups, which lowering builds: time in PostgreSQL for 1000 groups of `GROUP BY` of 10 rows each, of a page of 20 groups after offsets of 0, 100, and 900, ordered by the key and by an aggregate, and of the first groups of 100 keys of `DISTINCT ON` of 10 groups each, for all keys, a page of 10, and a page of 10 after an offset of 10.
// PostgreSQL evaluates the select list of a query of groups for the groups that an offset skips, and, without a limit, for every group before `DISTINCT ON` removes all but the first group of each key, while over a derived source it evaluates it only for the groups of the page.

import { measureExecution, runBenchmark } from "../harness"
import { createNestedTables, packRow, selectNested } from "../nested-rows"

await runBenchmark(async run => {
  const tables = await createNestedTables(run)
  // Rows grouped by the column `id`, 10 for each parent, whose nested rows the groups select, and a column without an index that an aggregate sorts the groups by.
  await run("CREATE TEMP TABLE entry (id integer, rank integer)")
  await run(
    "INSERT INTO entry SELECT p.id, (p.id * 7919 + n * 104729) % 100003 FROM parent AS p, generate_series(1, 10) AS n",
  )
  await run("ANALYZE entry")
  for (const table of tables) {
    const { fields } = table
    const nested = selectNested(table, ["c.position", ...fields.map(field => `c.${field.name}`)])
    const items = `(SELECT coalesce(json_agg(${packRow(fields)} ORDER BY s.position), '[]'::json) FROM (${nested}) AS s) AS items`
    for (const [name, order, outerOrder] of [
      ["key", "ORDER BY 1", "ORDER BY p.id"],
      ["sum", "ORDER BY 3 DESC, 1", "ORDER BY p.total DESC, p.id"],
    ] as const) {
      for (const offset of [0, 100, 900]) {
        const page = `${order} LIMIT 20 OFFSET ${offset}`
        const plain = await measureExecution(
          run,
          `SELECT p.id, count(*), sum(p.rank), ${items} FROM entry AS p GROUP BY 1 ${page}`,
        )
        const derived = await measureExecution(
          run,
          `SELECT p.id, p.count, p.total, ${items} FROM (SELECT p.id, count(*) AS count, sum(p.rank) AS total FROM entry AS p GROUP BY 1 ${page}) AS p ${outerOrder}`,
        )
        console.log(
          `${String(fields.length).padStart(2)} fields, by ${name}, offset ${String(offset).padStart(3)}: PostgreSQL ${plain.toFixed(2)} ms over the groups, ${derived.toFixed(2)} ms over a derived page`,
        )
      }
    }
    for (const page of ["", " LIMIT 10", " LIMIT 10 OFFSET 10"]) {
      const order = "ORDER BY 2, 3 DESC"
      const plain = await measureExecution(
        run,
        `SELECT DISTINCT ON (2) p.id, p.id % 100, sum(p.rank), ${items} FROM entry AS p GROUP BY 1 ${order}${page}`,
      )
      const derived = await measureExecution(
        run,
        `SELECT p.id, p.key, p.total, ${items} FROM (SELECT DISTINCT ON (2) p.id, p.id % 100 AS key, sum(p.rank) AS total FROM entry AS p GROUP BY 1 ${order}${page}) AS p ORDER BY p.key, p.total DESC`,
      )
      console.log(
        `${String(fields.length).padStart(2)} fields, first groups, ${(page.trim() || "all").padEnd(18)}: PostgreSQL ${plain.toFixed(2)} ms over the groups, ${derived.toFixed(2)} ms over derived first groups`,
      )
    }
  }
})
