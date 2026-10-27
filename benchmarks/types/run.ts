// Runs the benchmarks of the type-check cost, `*.bench.ts` of this directory, with Attest under Node, since Attest fails under Bun.
// Each `bench(...).types()` prints the instantiations that its callback adds to its file and their change from the count written in it; `-u` writes the measured counts.

import { readdirSync } from "node:fs"
import { join } from "node:path"

const directory = import.meta.dirname

process.env.ATTEST_CONFIG = JSON.stringify({
  // TypeScript 7 of the `typescript` package, rather than its Rust port when that is installed
  checker: "tsgo",
  tsconfig: join(directory, "tsconfig.consumer.json"),
  // Attest formats the files whose counts it writes.
  formatCmd: join(directory, "../../node_modules/.bin/oxfmt"),
  // Print the change of every benchmark rather than stop at the first that grows by more than 20%.
  benchErrorOnThresholdExceeded: false,
})
// Attest keeps its cache in `.attest` of the working directory.
process.chdir(directory)

for (const file of readdirSync(directory).toSorted()) {
  if (file.endsWith(".bench.ts")) {
    await import(`./${file}`)
  }
}
