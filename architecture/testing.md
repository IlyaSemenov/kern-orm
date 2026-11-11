# Testing

- **Test helpers** (`test-helpers.ts`, exported from `kern-db/testing`): test transactions and test fixtures of a database created with `test: true`, created once per project with the `before` and `after` hooks of a test runner.
  They run through the transaction coordinator of the database, which they find by the object of the database, so they require the database that `createDatabase` created rather than a copy of it ([transactions](transactions.md)).
  The coordinator keeps its [test fixtures](#test-fixtures) in a fixture stack (`transaction/fixture-stack.ts`).
- **Test runners**: the test helpers support `bun:test` on Bun, and `node:test` and Vitest on Node.js.
  Scenarios of each runner, run in a subprocess, check its timeouts and hooks: those of `bun:test` from the sources with the recording driver, and those of `node:test` and Vitest against the packed packages with a recording driver and in PostgreSQL, where they also check the abort signal of a test.
- **Test harness** (`testing/` of the repository): the private workspace `@kern-orm/test-harness`, which holds the helpers of PostgreSQL and the recording driver that the tests of the packages share: `describePostgres` and `describePooledPostgres` give a block of tests a `Database` in PostgreSQL at `DATABASE_URL`.
  It is not published; the tests import it by name, so that no workspace imports a module of another by a relative path.

## Package test

The package test (`packages/orm/tests/package/`) checks the packed packages as consumer projects outside the workspace install them, without the `paths` of the repository and the overrides of its workspace:

- It packs each published package at the version that the release of the pending changesets gives it, serves the tarballs from a registry of its own, and installs them with npm, so that no step needs a package published first, and a range that the version of the release plan does not satisfy fails it.
- It checks that the dependencies, peer dependencies, and optional dependencies of the published manifests have no `catalog:` or `workspace:` protocol, and that `kern-db` and `kern-migrations` depend on nothing of `kern-orm`, also in their code and declarations.
- A consumer of `kern-orm` and `kern-migrations`, and a consumer of `kern-db` and `kern-migrations` without `kern-orm` and `pg`, type-check under the pinned TypeScript and the minimum version, and run on Node.js and Bun, also in PostgreSQL at `DATABASE_URL`.
- The consumer of `kern-db` includes a query builder of another author, which compiles fragments of the layer with `kern-db/builder` alone.
- The consumers emit the declarations of modules that export values, under both versions of TypeScript, also of a module that imports only `kern-orm/types`, `kern-orm/db/types`, or `kern-db/types`, in a program of its own, since a module of another entry point in the program would name the types that the entry point fails to export.
- A third consumer of `kern-orm`, which npm installs with `--install-strategy=nested`, cannot resolve `kern-db`, as in a strict layout such as of pnpm, so its declarations name the types of `kern-db` only through the entry points of `kern-orm`, also from a module that imports only its root.
- The built code of `kern-migrations` imports nothing of `kern-db`, which only its declarations import, and a bundled consumer of `kern-db` includes no module but its own and those of `kern-db`.

## Test transactions

- Test transactions reuse the ambient transaction coordinator and always roll back.
  A test transaction runs a callback in a context created on each call, so every run and retry of a test gets its own level.
  A test wraps its body, or a Vitest `aroundEach` hook wraps the test with its other hooks, since test runners do not carry the async context of an ordinary hook into the test.
- A test transaction and a test fixture take an [isolation level](transactions.md#isolation), which the transactions of code under test nested in them must match.
- A database created for tests rejects every statement and transaction outside a test transaction or the seed of a test fixture instead of running them on the pool.
  It rejects a [session](transactions.md#sessions) everywhere, since none of its statements can run outside a transaction.
- Late code of a timed-out test never runs in the transaction of another test, but it keeps running in its own level until that level ends, is aborted, or, in a fixture, is preempted.
- A test transaction takes the abort signal of its test, such as `t.signal` of `node:test` or the signal of the test context of Vitest; `bun:test` has no signal for each test and relies on preemption.
  - Aborted while it waits for its turn in the fixture stack or for a connection, it rejects at once and never calls its callback: its change of the stack starts nothing, so it never preempts the active level, and a connection acquired after the abort returns to the pool.
  - Aborted while it preempts the active level of its fixture, it rejects once the preemption ends, without starting its level.
  - Aborted while its `BEGIN` or `SAVEPOINT` runs, its level ends once the statement completes, without calling its callback.
  - Aborted while its callback runs, its level stops accepting statements at once and ends without waiting for the callback, as closing a fixture does with its seed; the late rejection of the callback stays handled.
  - It rejects with the reason of the signal, once its level ends if it started one; a failure to start or end its level after the abort suppresses the reason in a `SuppressedError`.
  - An abort after the callback settles does nothing: the level stops listening to the signal once the callback settles, since `node:test` aborts the signal after every test.
- A statement already sent by a level that ends, whether by an abort, a preemption, or the closing of a fixture, completes before the rollback and delays the next level until then; `statement_timeout` of the connection bounds it.
  kern-db does not cancel it: a [cancel request](https://www.postgresql.org/docs/current/protocol-flow.html#PROTOCOL-FLOW-CANCELING-REQUESTS) interrupts whatever the backend runs when it arrives, such as the rollback or a statement of the next test, and gives no reply on whether it did.

## Test fixtures

- Test fixtures of a database created for tests form a stack of outer levels for serial tests, such as migrations for a whole test run and data of one test file: the first fixture is a transaction on a reserved connection, and each next one is a savepoint in the innermost one.
  A fixture has no context of its own.
- While a fixture is open, a test transaction started outside any transaction runs as a savepoint in the innermost fixture, so tests need no access to fixtures.
  Creating a fixture runs its seed callback in a savepoint that is released, so its changes stay in the fixture; a fixture whose seed fails rolls back and closes.
  Creating and closing a fixture are allowed only outside any transaction context, so late code of a finished level cannot reach a fixture, and a seed cannot wait for a change of the stack queued behind it.
- A fixture runs one nested level at a time, a test transaction or the next fixture; a new one preempts the active one.
  The preempted level closes at once, so its later statements fail, its statements already sent complete, and its savepoint rolls back and is released before the new level starts.
  All changes of the fixture stack, such as choosing the parent of a new level, creating, and closing a fixture, run one after another in one queue of the database.
  A failed rollback poisons the fixture, which then rejects new levels; closing it still rolls back.
  Preemption cannot tell a timed-out test from a concurrent one, so a concurrent test of the same fixture fails instead of sharing it.
- Closing a test fixture rolls back all levels nested in it, innermost first, and then the fixture itself, as one change of the fixture stack; the closed fixtures leave the stack even if their cleanup fails.
  The closing call reports every cleanup failure of the cascade, and the first fixture releases its connection once.
  A failed release of that connection rejects neither the closing nor an opening, and goes to the handler of [failed releases](transactions.md#levels), as for a transaction.
- Closing an already closed fixture, including one closed with an enclosing fixture, does nothing; `close` and async disposal behave the same.
- `useTestFixture` opens its fixture in a `before` hook and closes it in an `after` hook, since the body of a `describe` block runs synchronously while the runner collects tests.
- Closing a fixture that is still opening does not wait for its seed, which may never settle: the opening rejects, the fixture and the level of its seed roll back as when a fixture closes, and a later scope opens its own fixture once the rollback completes.
  The closing reports every failure of an opening that ends after it is requested, such as a failed `BEGIN`, a rejected seed, or a failed rollback; the `before` hook of `useTestFixture` ignores the rejection of an opening that its `after` hook has already closed.
- Closing an open fixture first closes the fixtures opening in it, since `node:test` runs the `after` hook of a preload module before the one of a test file, and a seed that never settles would hold the queue of the fixture stack.
  A fixture started after a closing of an open fixture is requested opens outside of the closed fixture, so a repeated closing of the closed fixture or a closing of a fixture nested in it leaves the new fixture open.
- The `data` of a fixture throws while the fixture is not open, including after an enclosing fixture closes it.
