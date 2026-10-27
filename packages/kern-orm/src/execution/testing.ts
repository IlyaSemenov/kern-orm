import type { Database } from "./database"

/** Test fixture of `useTestFixture`, open while the tests of its `describe` block or test file run. */
export interface TestFixture<T = unknown> {
  /** Result of the seed of the fixture; reading it while the fixture is not open throws. */
  readonly data: T
}

/** Test fixture opened by the transaction coordinator: an outer transaction of a database created for tests, which always rolls back when it closes. */
export interface OpenedTestFixture<T = unknown> extends AsyncDisposable {
  /** Result of the seed of the fixture, such as the records it created; reading it after the fixture closes throws. */
  readonly data: T
  /** Rolls back the fixture and the fixtures opened inside it; closing a closed fixture does nothing. */
  close(): Promise<void>
}

/** Test fixture that is being opened, with a `close` that can be called before it opens. */
export interface PendingTestFixture<T = unknown> {
  readonly fixture: Promise<OpenedTestFixture<T>>
  close(): Promise<void>
}

/**
 * Hooks of a test runner that run a function before and after the tests of the current `describe` block or test file.
 *
 * They are `before` and `after` of `node:test`, and `beforeAll` and `afterAll` of `bun:test` and Vitest.
 */
export interface TestHooks {
  before(hook: () => Promise<void>): unknown
  after(hook: () => Promise<void>): unknown
}

/** Test transactions and test fixtures of a database created with `test: true`. */
export interface TestHelpers {
  /**
   * Runs `callback` in a transaction that always rolls back.
   *
   * Wrap the body of every test in it, so that every run of the test gets its own transaction.
   * Inside an existing transaction, it starts a nested transaction that always rolls back.
   */
  testTransaction<T>(callback: () => Promise<T>): Promise<T>
  /**
   * Opens a test fixture for the tests of the current `describe` block or test file and runs `seed` in it, such as migrations or data shared by the tests.
   *
   * The fixture opens in the `before` hook and rolls back in the `after` hook.
   * The changes of `seed` stay for the test transactions that run while the fixture is open, and its result is the `data` of the fixture.
   * Test fixtures nest: a new one opens inside the innermost open one, and test transactions run in the innermost one.
   * A fixture whose `seed` rejects rolls back and closes.
   */
  useTestFixture<T>(seed: () => Promise<T>): TestFixture<T>
}

/** Creates the test helpers of a database created with `test: true`, registering fixtures with the hooks of a test runner. */
export function createTestHelpers(database: Database, hooks: TestHooks): TestHelpers {
  const { coordinator } = database
  if (!coordinator.test) {
    throw new Error("createTestHelpers requires a database created with test: true")
  }
  return {
    testTransaction: callback => coordinator.testTransaction(callback),
    useTestFixture<T>(seed: () => Promise<T>) {
      let pending: PendingTestFixture<T> | undefined
      let fixture: OpenedTestFixture<T> | undefined
      hooks.before(async () => {
        const current = coordinator.startTestFixture(seed)
        pending = current
        // The after hook has already closed a fixture whose before hook timed out, and its closing reports the failures of the rollback.
        try {
          const opened = await current.fixture
          if (pending === current) {
            fixture = opened
          }
        } catch (error) {
          if (pending === current) {
            throw error
          }
        }
      })
      hooks.after(async () => {
        const current = pending
        pending = undefined
        fixture = undefined
        // Closing does not wait for the seed, so the next scope never nests in a fixture whose seed outlives timed-out hooks.
        await current?.close()
      })
      return {
        get data() {
          // The body of a describe block runs while the runner collects tests, before the fixture opens.
          if (!fixture) {
            throw new Error(
              "Test fixture is not open: read its data in the tests and hooks of the describe block or test file that uses it",
            )
          }
          return fixture.data
        },
      }
    },
  }
}
