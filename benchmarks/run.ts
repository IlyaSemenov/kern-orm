// Runs the benchmark suite named by the first argument, such as `nested-transport` for `suites/nested-transport.ts`.

import { readdirSync } from "node:fs"

const suites: string[] = []
for (const file of readdirSync(new URL("suites", import.meta.url))) {
  if (file.endsWith(".ts")) {
    suites.push(file.slice(0, -".ts".length))
  }
}
const name = process.argv[2]
if (name === undefined || !suites.includes(name)) {
  console.error(`Pass the name of a suite: ${suites.toSorted().join(", ")}`)
  process.exit(1)
}
await import(`./suites/${name}.ts`)
