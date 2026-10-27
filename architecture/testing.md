# Testing

- **Test helpers** (`execution/testing.ts`, exported from `kern-orm/testing`): test transactions and test fixtures of a database created with `test: true`, created once per project with the `before` and `after` hooks of a test runner.
  They run through the transaction coordinator of the database.

## Test transactions

- Test transactions reuse the ambient transaction coordinator and always roll back.
  A test transaction runs a callback in a context created on each call, so every run and retry of a test gets its own level.
  A test wraps its body, or a Vitest `aroundEach` hook wraps the test with its other hooks, since test runners do not carry the async context of an ordinary hook into the test.
- A database created for tests rejects every statement and transaction outside a test transaction or the seed of a test fixture instead of running them on the pool.
- Late code of a timed-out test never runs in the transaction of another test, but it keeps running in its own level until that level ends or, in a fixture, is preempted.

## Test fixtures

- Test fixtures of a database created for tests form a stack of outer levels for serial tests, such as migrations for a whole test run and data of one test file: the first fixture is a transaction on a reserved connection, and each next one is a savepoint in the innermost one.
  A fixture has no context of its own.
- While a fixture is open, a test transaction started outside any transaction runs as a savepoint in the innermost fixture, so tests need no access to fixtures.
  Creating a fixture runs its seed callback in a savepoint that is released, so its changes stay in the fixture; a fixture whose seed fails rolls back and closes.
  Creating and closing a fixture are allowed only outside any transaction context, so late code of a finished level cannot reach a fixture, and a seed cannot wait for a change of the stack queued behind it.
- A fixture runs one nested level at a time, a test transaction or the next fixture; a new one preempts the active one.
  The preempted level closes at once, so its later statements fail, its statements already sent complete, and its savepoint rolls back and is released before the new level starts.
  All changes of the fixture stack, such as choosing the parent of a new level, creating, and closing a fixture, run one after another in one queue of the database.
  A failed rollback poisons the fixture, which then rejects new levels; closing it still rolls back, and closing the first fixture returns a recovered connection to the pool.
  Preemption cannot tell a timed-out test from a concurrent one, so a concurrent test of the same fixture fails instead of sharing it.
- Closing a test fixture rolls back all levels nested in it, innermost first, and then the fixture itself, as one change of the fixture stack; the closed fixtures leave the stack even if their cleanup fails.
  The closing call reports every cleanup failure of the cascade, and the first fixture releases its connection once, with a failure only if its own `ROLLBACK` failed.
- Closing an already closed fixture, including one closed with an enclosing fixture, does nothing; `close` and async disposal behave the same.
- `useTestFixture` opens its fixture in a `before` hook and closes it in an `after` hook, since the body of a `describe` block runs synchronously while the runner collects tests.
- Closing a fixture that is still opening does not wait for its seed, which may never settle: the opening rejects, the fixture and the level of its seed roll back as when a fixture closes, and a later scope opens its own fixture once the rollback completes.
  The closing reports every failure of an opening that ends after it is requested, such as a failed `BEGIN`, a rejected seed, or a failed rollback; the `before` hook of `useTestFixture` ignores the rejection of an opening that its `after` hook has already closed.
- Closing an open fixture first closes the fixtures opening in it, since `node:test` runs the `after` hook of a preload module before the one of a test file, and a seed that never settles would hold the queue of the fixture stack.
  A fixture started after a closing of an open fixture is requested opens outside of the closed fixture, so a repeated closing of the closed fixture or a closing of a fixture nested in it leaves the new fixture open.
- The `data` of a fixture throws while the fixture is not open, including after an enclosing fixture closes it.

## Open questions

- Test timeouts: a timeout alone does not close a test transaction; it closes when it is preempted or its callback settles.
  A deadline or the abort signal of a test runner, such as the one of Vitest, could close it earlier.
  A statement already sent by a preempted level or by the seed of a closed fixture delays the next level until it completes; cancelling it needs a driver capability.
- After-commit hooks in tests: hooks run after the outermost commit, and a test transaction never commits, so hooks registered by the tested code never run in a test.
  How tests run or check them is not designed yet.
