# Testing

::: info Using the ORM?
See [Testing of the ORM](../orm/testing): this page describes kern-db without the ORM.
:::

Run each test in a test transaction, which always rolls back, so that tests leave the data in the database unchanged.
Test transactions need a database created with `test: true`:

```ts
export const database = createDatabase({
  driver: postgresJsDriver(postgres(process.env.DATABASE_URL!)),
  test: process.env.NODE_ENV === "test",
})
```

Create the test helpers of the database once, in a module of your tests, with the hooks of your test runner, and wrap its `test` with `wrapTest`:

::: code-group

```ts [node:test]
// test/helpers.ts
import { after, before, test as runnerTest } from "node:test"

import { createTestHelpers } from "kern-db/testing"

export const { testTransaction, useTestFixture, wrapTest } = createTestHelpers(database, {
  before,
  after,
})

export const test = wrapTest(runnerTest)
```

```ts [bun:test]
// test/helpers.ts
import { afterAll, beforeAll, onTestFinished, test as runnerTest } from "bun:test"

import { createTestHelpers } from "kern-db/testing"

export const { testTransaction, useTestFixture, wrapTest } = createTestHelpers(database, {
  before: beforeAll,
  after: afterAll,
  onTestFinished,
})

export const test = wrapTest(runnerTest)
```

:::

Declare tests with this `test` instead of the one of the test runner, so that every test runs in its own test transaction.
It takes the same options as the original, such as a timeout, and has the same modifiers, such as `test.skip`, `test.only`, and `test.each`:

```ts
import assert from "node:assert/strict"

import * as t from "kern-db/types"

import { test } from "./helpers"

test("publishes a form", async () => {
  await publishForm(formId)
  const published = await database.query`SELECT published FROM form WHERE id = ${formId}`.get(
    t.boolean,
  )
  assert.equal(published, true)
})
```

Hooks such as `beforeEach` run outside of the test transaction, so create the data of each test in the test itself, and data shared by several tests in a [fixture](#fixtures).
For asynchronous tests, return a promise instead of using a `done` callback.

With Vitest, pass `{ before: beforeAll, after: afterAll }` to `createTestHelpers`, and instead of `wrapTest`, run every test in a test transaction with `aroundEach` in a setup file.
It runs the hooks of the test in the test transaction as well, so `beforeEach` can create data for each test:

```ts
// vitest.setup.ts, listed in setupFiles of the Vitest config
import { aroundEach } from "vitest"

aroundEach((runTest, { signal }) => testTransaction(runTest, { signal }))
```

Transactions of the tested code run as [nested transactions](./transactions#nested-transactions) of the test transaction.
When the tested code starts a transaction at an [isolation level](./transactions#isolation-level), the test transaction must run at the same level, since a nested transaction runs at the level of its transaction.
Pass the level to `useTestFixture` when the test runs in a fixture, or declare the test with the `test` of the test runner and pass the level to `testTransaction`, which takes the body of the test:

```ts
import { test } from "node:test"

test("assigns the next position", () =>
  testTransaction(
    async () => {
      await addField(formId, "Name")
      // ...
    },
    { isolation: "serializable" },
  ))
```

A test transaction does not count as a transaction for [`isInTransaction()` and `ensureTransaction`](./transactions#joining-the-current-transaction), so that the tested code behaves as in production.
To test how the code behaves inside a transaction, wrap the call in `database.transaction` in the test.

Such a database rejects statements and transactions outside test transactions and the seeds of [fixtures](#fixtures).
Statements of a test that keep running after it times out never run in the transaction of another test.

Rolling back does not reset PostgreSQL sequences, so the IDs a test generates may differ between runs: compare them with the records the test creates, not with literal values.

## Fixtures

To prepare the database once for several tests, such as with migrations or shared data, run the preparation in a test fixture.
The fixture keeps its changes for the tests that run while it is open, returns the result of its callback as its `data`, and rolls back its changes after the tests.

A fixture that opens while another one is open nests in it, and tests run in the innermost one.

Open a fixture for the tests of a test file or of a `describe` block with `useTestFixture`:

```ts
import { describe } from "node:test"

import { test } from "./helpers"

describe("forms of an author", () => {
  const fixture = useTestFixture(async () => ({ author: await createAuthor() }))

  test("lists the forms of an author", async () => {
    await createForm({ authorId: fixture.data.author.id })
    // ...
  })
})
```

Put a fixture for all tests, such as one that applies [migrations](../migrations/), into a setup module:

```ts
// test/setup.ts
import { migrate } from "kern-migrations"

useTestFixture(() => migrate(database, migrations))
```

On a database whose transactions default to `repeatable read` or `serializable`, pass `{ isolation: "read committed" }` to such a fixture: `migrate` rejects in a transaction at a stricter level when it has migrations to apply.

Run the statements of the preparation through the database, such as the SQL of migrations with [`database.script`](./sql#scripts), so that the fixture rolls them back: a tool that connects to PostgreSQL on its own commits its changes.

Each test runner loads the setup module in its own way:

- `node:test` loads it with `NODE_ENV=test node --import ./test/setup.ts --test "test/**/*.test.ts"`; unlike Bun and Vitest, Node.js does not set `NODE_ENV`, and the pattern keeps the setup module from running as a test file.
  It runs each test file in its own process by default, so the setup module runs once for each test file.
  With `--test-isolation=none`, all test files load before their tests run, so call `useTestFixture` inside a `describe` that holds the tests of a file.
- `bun:test` loads it as a preload, such as `preload = ["./test/setup.ts"]` in the `[test]` section of `bunfig.toml`.
  It runs all test files in one process, one after another, so the setup module runs once for the whole run.
- Vitest loads it as a setup file in `setupFiles`.
  It runs the setup files once for each test file.

Test files that run in parallel processes, as `node:test` and Vitest run them by default, each have their own fixtures, and fixtures that create or alter the same tables, such as migrations, make them run one after another.

While a fixture is open, tests run one at a time: a test transaction that starts while another one still runs, such as one that timed out, rolls the other one back.

## Tests that time out

A test rolls back its transaction as soon as the test runner gives up on the test, such as when it times out:

- With `node:test`, the `test` of `wrapTest` passes the abort signal of the test to its test transaction.
- With `bun:test`, which gives no signal for a test, the `test` of `wrapTest` relies on `onTestFinished` passed to `createTestHelpers`.
- With Vitest, `aroundEach` above passes the abort signal of the test to `testTransaction`.

Then the later statements of the test fail, and its transaction rolls back without waiting for the test to finish.

For a test that wraps its body in `testTransaction` itself, pass the abort signal of the test to `testTransaction` for the same effect:

```ts
test("assigns the next position", t =>
  testTransaction(
    async () => {
      await addField(formId, "Name")
      // ...
    },
    { isolation: "serializable", signal: t.signal },
  ))
```

Without a signal, as with `testTransaction` under `bun:test`, the transaction of a test that times out stays open until the code of the test finishes or, while a fixture is open, until the next test starts.

A statement that the test has already sent runs to its end before the rollback.
To limit how long such a statement delays the next test, set `statement_timeout` for the connections of the test database.

## Statements that wait for a lock

To check that a statement waits for a lock that another transaction holds, such as of a row that it updates, read the backend PID of its transaction with `getBackendPid`.
Then pass the PID to `waitForLock`, which resolves once the backend waits for a lock:

```ts
import { getBackendPid, waitForLock } from "kern-db/testing"

// Simplified example: a failure before the backend PID is read leaves the lock held.
// Another transaction locks the form until the test unlocks it.
const locked = Promise.withResolvers<void>()
const unlock = Promise.withResolvers<void>()
const locking = database.transaction(async () => {
  await database.query`SELECT 1 FROM form WHERE id = ${formId} FOR UPDATE`
  locked.resolve()
  await unlock.promise
})
await locked.promise

const backend = Promise.withResolvers<number>()
const publishing = database.transaction(async () => {
  backend.resolve(await getBackendPid(database))
  await database.query`UPDATE form SET published = true WHERE id = ${formId}`
})
try {
  await waitForLock(database, await backend.promise)
} finally {
  unlock.resolve()
  await Promise.all([locking, publishing])
}
```

Run such tests on a database created without `test: true`, since their transactions run beside each other.

When the code under test runs the statement on a connection that the test cannot reach, wait for it by a part of its text with `waitForLockedStatement`, which resolves to its backend PID.
Both reject when nothing waits within 2 seconds; pass `timeout` to wait longer or shorter.

## Test migrations

To check that every migration applies and rolls back, and how migrations change existing rows, see [Test migrations](../migrations/#test-migrations).
