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

A statement of the tested code outside a transaction runs in a nested transaction of its own, so that a failed statement, such as one that violates a unique constraint, undoes only itself, as in production.
A statement that sets the isolation level with `SET TRANSACTION` fails there, so pass the level as above.

Statements and transactions that a test runs at once take turns on the connection of its test transaction: a statement waits while a transaction of the tested code runs, and a test that passes rolls back after the statements and transactions that it started without awaiting them.
A transaction that waits for a statement started outside of it in the same test never ends on its own: it rolls back when the test times out, as [Tests that time out](#tests-that-time-out) describes, or, while a fixture is open, when the next test starts.

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

Put a fixture for all tests, such as one that applies [migrations](../migrations/applying), into a setup module:

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

## Browser tests

To run browser tests, such as with Playwright, against a running server, run the requests of each test in a test transaction that the server opens when the test starts and rolls back when it ends.

Start the server for browser tests with a database created with `test: true`, prepare the database in a fixture with `openTestFixture`, and add routes that open and close the test transaction of a test, and a middleware that runs every request of a test in its test transaction, such as with Hono:

```ts
import { Hono } from "hono"
import type { OpenedTestTransaction } from "kern-db/testing"
import { openTestFixture, openTestTransaction } from "kern-db/testing"

await openTestFixture(database, async () => {
  await migrate(database, migrations)
  await createSharedData()
})

const tests = new Map<string, OpenedTestTransaction>()
const app = new Hono()

app.post("/test/begin", async c => {
  const id = crypto.randomUUID()
  tests.set(id, await openTestTransaction(database))
  return c.json({ id })
})

app.post("/test/end/:id", async c => {
  const id = c.req.param("id")
  const transaction = tests.get(id)
  tests.delete(id)
  await transaction?.close()
  return c.body(null, 204)
})

// Registered after the routes above, so that they run outside of test transactions.
app.use(async (c, next) => {
  const id = c.req.header("x-test-id")
  if (id === undefined) {
    return next()
  }
  const transaction = tests.get(id)
  if (!transaction?.isOpen) {
    tests.delete(id)
    return c.text("The test is not running", 409)
  }
  return transaction.run(next)
})
```

In the browser tests, open the test transaction before each test, send its ID with every request of the browser, and close it after closing the browser, such as with an automatic fixture of Playwright:

```ts
import { test as base } from "@playwright/test"

export const test = base.extend<{ testId: string }>({
  testId: [
    async ({ context, request }, use) => {
      const response = await request.post("/test/begin")
      const { id } = await response.json()
      await context.setExtraHTTPHeaders({ "x-test-id": id })
      await use(id)
      // The browser sends no more requests once its context closes.
      await context.close()
      await request.post(`/test/end/${id}`)
    },
    { auto: true },
  ],
})
```

Send the ID also with the requests that a test sends to the server itself, such as to create its data:

```ts
test("lists the forms", async ({ page, request, testId }) => {
  await request.post("/forms", { data: { name: "Survey" }, headers: { "x-test-id": testId } })
  await page.goto("/forms")
  // ...
})
```

The ID ties a request to its test, so a request that comes late, after its test has ended or the next test has rolled back its test transaction, never runs in the test transaction of the next test, and the server answers it with 409.
When the pages send requests to the server from another origin, allow the header in the CORS settings of the server.

The requests of a test see the changes of its earlier requests, and the changes of all of them roll back when the test ends:

- The statements and transactions of the requests take turns on the connection of the test transaction, as those of any test do, so a failed statement of a request undoes only itself.
  A transaction of a request that waits for another request of the same test, such as for a request to the same server, waits until the test ends.
- A statement of a request that keeps running after its test has ended fails.

While a fixture is open, browser tests run one at a time: opening a test transaction rolls back the one still open, such as of a test that crashed.
Without a fixture, each test transaction runs on a connection of its own, so tests can run in parallel workers, each creating its own data in its test transaction, on a database that has its migrations applied.

Closing the database rolls back the fixture and the open test transactions.

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

To check that every migration applies and rolls back, and how migrations change existing rows, see [Testing Migrations](../migrations/testing).
