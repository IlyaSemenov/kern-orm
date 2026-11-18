# Testing

How to place and write the tests of kern-orm.

## Placement

- Keep focused module tests beside their source: `foo.test.ts` and `foo.type-test.ts` test `foo.ts`.
- Test each behavior at the lowest level that can check it: a helper directly, a module that combines helpers by its own unit tests.
- Keep a test of how several modules work together beside the module that combines them, or beside the modules it covers until such a module exists.
- Keep a test helper that builds or reads internals beside them in `src/<module>/testing.ts`, such as `src/ast/testing.ts`, so that nothing outside `src/` imports from `src/`.
- Keep integration and package-boundary tests, with fixtures of their own, in `packages/*/tests/`, importing packages by name: they see only the public API.
- Keep the test harness shared by the tests of a package in `packages/*/testing/`, and that of an example in `examples/*/testing/`, importing packages by name.
  Keep a harness that the tests of several packages share, such as `describePostgres` of a `Database` and the recording driver, in the private workspace `testing/`, `@kern-orm/test-harness`, which they import by name and declare in `devDependencies` as `workspace:*`.
- Use `examples/` as acceptance tests of the public API in realistic multi-schema setups.
- Name runtime tests `*.test.ts`, compile-only type tests `*.type-test.ts`, and tests of the packed packages `*.package-test.ts`.

## Structure

- Add a `describe` block where the file gives a reason for it: several APIs or behaviors in one file, or a fixture that belongs to some cases but not all.
  Name such a block after what it covers and keep its fixtures inside it.
- Distinguish several same-kind values by role rather than by order.
  When values differ only by order, number them with digits instead of ordinal words.
- Keep tests deterministic so a failure repeats on every run.
  Generate random inputs from an explicit seed and print the seed in failure messages so the failing input can be replayed.
- Structure type tests with `describe` and `test` from `bun:test`, like runtime tests; `bun test` does not run them, and typecheck checks their bodies.
- Put a call that no overload accepts on one line under `@ts-expect-error`: TypeScript 6 reports it at the call, and TypeScript 7 at the argument.

## Test runners

- Write runtime tests for both runners: the `test` script runs them under `bun:test`, and the `test:node` script under Vitest, which resolves `bun:test` to `vitest`.
  - Import the test API from `bun:test` and use only what Vitest also has, apart from the matchers that `vitest.setup.ts` takes from `jest-extended`, such as `toStartWith`.
    Register there by name any other matcher of `jest-extended` that a test needs, rather than all of them: some, such as `toBeOneOf` and `toBeNaN`, differ from those of Vitest.
  - Do not use the test context of Vitest, such as its `signal`: `bun:test` passes a `done` callback to a test function that declares a parameter.
  - Check an error with `toEqual(new X(message))`, which compares its class and fields in both runners: `rejects.toEqual` for a promise, and `getThrownError` of `@kern-orm/test-harness/errors` for a callback that throws.
    `toThrow(new X(message))` of Bun compares only the message.
  - In Bun 1.4.4, `await expect(promise).rejects` ignores the timeout of the test, so a regression that leaves the promise pending hangs `bun test`; the `test:node` script fails such a test at its timeout instead.
- Test how the test helpers work with a test runner, such as with its timeouts, hooks, and abort signal, by running the runner in a subprocess with a timeout and checking the outcome of each test and the recorded statements: `bun:test` in `packages/db/tests/test-runner.test.ts`, and `node:test` and Vitest against the packed packages in the package test.

## Database

- Test SQL generation and transaction routing without a database through the recording driver of `testing/recording-driver.ts`.
- Declare tests that need PostgreSQL in `kern-orm` with `describePostgres` of `packages/orm/testing/postgres.ts`, which skips them without `DATABASE_URL` and gives them a database created with `test: true`, and in `kern-db` with that of `testing/postgres.ts`, which gives them a `Database`.
  In `examples/forms`, declare them with `describePostgres` of `examples/forms/testing/postgres.ts`, which also creates the SaaS and the sample tenants in their PostgreSQL schemas.
  Declare tests that need statements outside a transaction to run on the pool, such as tests of transactions, with `describePooledPostgres` of the same files, which gives them a database without `test: true`.
- Leave the test database unchanged: create tables and data in `testTransaction` or in the seed of a test fixture of a database created with `test: true`, or, in a database without it, in a transaction that rolls them back or drops them, such as with `ON COMMIT DROP`, and close every fixture the test opens.
  Do not start a separate PostgreSQL cluster.
- Create an extension that a test needs, such as `vector` of pgvector, in its test transaction or the seed of its fixture, which roll it back; the server of the tests has pgvector, as the image of the CI service does.
- Test the contract of a driver with `describeDriverContract` of `kern-db/testing`, which the test of each driver of `kern-db`, such as `packages/db/tests/postgres-js.test.ts`, calls, skipping it when `DATABASE_URL` is not set; keep in that file only the tests of what its client alone does.
  Write the tests of the contract with `node:assert/strict` and only the functions of `DriverContractRunner`: users run them with any supported test runner.
- Check a query plan by what its execution processes, such as sequential scans, rows read, runs of subqueries, and buffer blocks, rather than by a snapshot of the plan.
  Keep each table of its data within 30000 rows and the statistics target at its default, so that ANALYZE reads every row.
- Test concurrent transactions through connection-level state, such as `pg_backend_pid()` and transaction-local settings from `set_config(..., true)`, rather than committed tables.
