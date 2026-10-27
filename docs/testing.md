# Testing

Run each test in a test transaction, which always rolls back, so that tests leave the data in the database unchanged.
Test transactions need a database created with `test: true`:

```ts
export const database = createDatabase({
  driver: postgresJsDriver(postgres(process.env.DATABASE_URL)),
  test: process.env.NODE_ENV === "test",
})
```

Create the test helpers of the database once, in a module of your tests, with the hooks of your test runner:

```ts
// test/helpers.ts
import { after, before } from "node:test"

import { createTestHelpers } from "kern-orm/testing"

export const { testTransaction, useTestFixture } = createTestHelpers(database, {
  before,
  after,
})
```

With `bun:test` and Vitest, pass `{ before: beforeAll, after: afterAll }`.

Wrap the body of every test in `testTransaction`, the same way with `node:test`, `bun:test`, and Vitest:

```ts
import assert from "node:assert/strict"
import { test } from "node:test"

test("publishes a form", () =>
  testTransaction(async () => {
    await publishForm(formId)
    const form = await db.form.find(formId).select("published")
    assert.deepEqual(form, { published: true })
  }))
```

With Vitest, `aroundEach` in a setup file runs every test in a test transaction together with its hooks, so tests need no wrapper and `beforeEach` can create data for each test:

```ts
// vitest.setup.ts, listed in setupFiles of the Vitest config
import { aroundEach } from "vitest"

aroundEach(runTest => testTransaction(runTest))
```

Transactions of the tested code run as [nested transactions](./transactions#nested-transactions) of the test transaction.

Such a database rejects queries and transactions outside test transactions and the seeds of [fixtures](#fixtures).
Queries of a test that keep running after it times out never run in the transaction of another test.

Rolling back does not reset PostgreSQL sequences, so the IDs a test generates may differ between runs: compare them with the records the test creates, not with literal values.

## Fixtures

To prepare the database once for several tests, such as with migrations or shared data, run the preparation in a test fixture.
The fixture keeps its changes for the tests that run while it is open, returns the result of its callback as its `data`, and rolls back its changes after the tests.

A fixture that opens while another one is open nests in it, and tests run in the innermost one.

Open a fixture for the tests of a test file or of a `describe` block with `useTestFixture`:

```ts
import { describe, test } from "node:test"

describe("forms of an author", () => {
  const fixture = useTestFixture(async () => ({ author: await createAuthor() }))

  test("lists the forms of an author", () =>
    testTransaction(async () => {
      await createForm({ authorId: fixture.data.author.id })
      // ...
    }))
})
```

Put a fixture for all tests, such as one with migrations, into a setup module:

```ts
// test/setup.ts
useTestFixture(() => migrate())
```

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
