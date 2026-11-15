# Benchmarks

How to write and run the benchmarks of kern-orm in `benchmarks/`.

- Back a decision made for speed or size, such as the SQL that the compiler builds instead of an alternative, with a benchmark, and link it from the decision in [decisions/](../decisions/README.md).
- Rerun a benchmark to update the ratios of its decision when a change affects what it measures.
- Do not run benchmarks in CI.

## SQL

- Write a benchmark of SQL as a script `benchmarks/suites/<topic>.ts`, such as `nested-transport.ts`, that compares the chosen variant with its alternatives through `runBenchmark` of `benchmarks/harness.ts`; its header names the variants and what it measures.
- Keep data and SQL shared by several benchmarks in a module beside the harness, such as `benchmarks/nested-rows.ts`.
- Run a benchmark with `bun run --cwd benchmarks bench <topic>`, which reads `DATABASE_URL` from `.env.test.local`.
- Generate the data of a benchmark deterministically, in SQL or from an explicit seed, inside the transaction of `runBenchmark`, which rolls back.

## Runtime

Write a benchmark of the time of the JavaScript of a hot path, without PostgreSQL, as a runtime benchmark `benchmarks/runtime/<topic>.bench.ts`, which mitata runs on Bun and Node.js against the built package.

- Export from it by default a `Topic` of `benchmarks/runtime/scenario.ts`, a function of the modules of a build of `kern-orm` that returns the scenarios, and import only types from `kern-orm` in it, so that it also runs against the build of another commit.
  Write its relative imports with their `.ts` extensions, since Node.js runs it.
- Return `unsupported(reason)` from a scenario that needs an API that the build lacks, after checking the API.
- Measure through the public API; attribute time to an internal step with a CPU profile rather than by importing internals.
- Run it with `bun run --cwd benchmarks bench:runtime <topic>`, and compare the current build with another commit with `--base <ref>`, such as `--base HEAD` for uncommitted changes.
- Treat a change whose confidence interval includes no change as inconclusive, and rerun it with more pairs through `--runs` before relying on it.

## Type-check cost

Measure the type-check cost of the API with the Attest benchmarks `benchmarks/types/*.bench.ts`: `bench(...).types()` counts the instantiations that its callback adds to its file, checked against the declarations of the built packages.

- Warm up a benchmark of a repeated call, such as a query, with a call of the same kind on other columns in `bench.baseline`, so that it counts each further call rather than the first.
- Run them with `bun run --cwd benchmarks bench:types`, which prints the change of each count from the one written in its file, and write the measured counts with `-u`.
- Find the types that a benchmark instantiates on each call with `bun run --cwd benchmarks profile:types types/<file> <name>`; the header of `benchmarks/types/profile.ts` describes its options.
- Read [benchmarks/types/PROFILING.md](../benchmarks/types/PROFILING.md) before measuring a cost that the benchmarks do not cover or looking for its cause.
