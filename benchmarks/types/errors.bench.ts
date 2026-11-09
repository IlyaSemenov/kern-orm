// Instantiations that a check of a `QueryError` by its condition adds to a consumer that already checks one of another condition.
// The count in `.types([...])` is the one that `bun run --cwd benchmarks bench:types -u` wrote; a run prints the change from it.

import { bench } from "@ark/attest"
import { isQueryError } from "kern-orm"

const error: unknown = new Error("rejected")

bench.baseline(() => {
  if (isQueryError(error, "foreign_key_violation")) {
    return error.code
  }
})

bench("isQueryError", () => {
  if (isQueryError(error, "unique_violation")) {
    return error.code
  }
}).types([18, "instantiations"])
