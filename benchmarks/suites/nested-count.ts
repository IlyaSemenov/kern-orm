// The count of the nested rows of each parent selected as a scalar subquery of `count(*)`, which lowering builds for a query of `count`, against the same count packed as nested rows of one value: time in PostgreSQL and of a round trip, for all parents.

import { measureExecution, measureRoundTrip, runBenchmark } from "../harness"
import { createNestedTables, packValue } from "../nested-rows"

await runBenchmark(async run => {
  const [table] = await createNestedTables(run)
  const count = `SELECT count(*) AS count FROM ${table!.name} AS c WHERE c.parent_id = p.id`
  const variants = [
    { name: "a scalar subquery", text: `SELECT p.id, (${count}) AS n FROM parent AS p` },
    {
      name: "a packed row",
      // Packing reads a scalar other than a column through a derived source with `OFFSET 0`.
      text: `SELECT p.id, (SELECT json_build_array(${packValue("s.count")}) FROM (${count} OFFSET 0) AS s) AS n FROM parent AS p`,
    },
  ]
  for (const { name, text } of variants) {
    const execution = await measureExecution(run, text)
    const { time } = await measureRoundTrip(run, text)
    console.log(
      `${name.padEnd(17)}: PostgreSQL ${execution.toFixed(2)} ms, round trip ${time.toFixed(2)} ms`,
    )
  }
})
