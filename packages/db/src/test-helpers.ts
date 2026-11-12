import type { Database, IsolationLevel } from "./database"
import { getCoordinator } from "./database"

/** Test fixture of `useTestFixture`, open while the tests of its `describe` block or test file run. */
export interface TestFixture<T = unknown> {
  /** Result of the seed of the fixture; reading it while the fixture is not open throws. */
  readonly data: T
}

/** Open test fixture of `openTestFixture`: an outer transaction of a database created for tests, which always rolls back when it closes. */
export interface OpenedTestFixture<T = unknown> extends AsyncDisposable {
  /** Result of the seed of the fixture, such as the records it created; reading it after the fixture closes throws. */
  readonly data: T
  /** Rolls back the fixture and the fixtures opened inside it; closing a closed fixture does nothing. */
  close(): Promise<void>
}

/** Open test transaction of `openTestTransaction`, which the callbacks of `run`, such as the requests of one browser test to a server, share until it closes. */
export interface OpenedTestTransaction extends AsyncDisposable {
  /**
   * Runs `callback` in the test transaction, so that its queries run there.
   *
   * Each query of the callback outside a transaction runs as a nested transaction of its own, so that a failed query undoes only itself, as in production.
   * A transaction of a callback runs as a nested transaction that the queries and transactions of the other callbacks wait for.
   * It rejects without calling `callback` once the test transaction is closed, and inside a transaction.
   */
  run<T>(callback: () => Promise<T>): Promise<T>
  /** Rolls back the test transaction; the later queries of its callbacks fail, and closing it again returns the same closing. */
  close(): Promise<void>
}

/** Options of `openTestTransaction`. */
export interface OpenTestTransactionOptions {
  /**
   * Isolation level of the test transaction, such as `serializable`, for code under test that starts a transaction at that level.
   *
   * Inside a test fixture, the test transaction runs at the level of the fixture: given another level, it rejects.
   */
  isolation?: IsolationLevel
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
  /**
   * Hook of a test runner that runs a function once the current test finishes, also when it times out, such as `onTestFinished` of `bun:test`.
   *
   * With it, a test that `wrapTest` declares rolls back its test transaction as soon as the runner gives up on the test, as with the abort signal of `testTransaction`.
   */
  onTestFinished?(hook: () => void): unknown
}

/** Options of `testTransaction`. */
export interface TestTransactionOptions {
  /**
   * Abort signal of the test, such as `t.signal` of `node:test` or `signal` of the test context of Vitest.
   *
   * When it aborts, the test transaction rejects the later queries of the test at once and rolls back without waiting for the test.
   * It then rejects with the reason of the signal.
   * If starting or rolling back the transaction fails, it rejects instead with a `SuppressedError` that keeps the reason.
   * Queries that the test has already sent complete before the rollback.
   */
  signal?: AbortSignal
  /**
   * Isolation level of the test transaction, such as `serializable`, for code under test that starts a transaction at that level.
   *
   * Inside a test fixture, the test transaction runs at the level of the fixture: given another level, it rejects.
   */
  isolation?: IsolationLevel
}

/** Options of `useTestFixture` and `openTestFixture`. */
export interface TestFixtureOptions {
  /**
   * Isolation level of the transaction of the fixture, such as `serializable`, at which the test transactions and fixtures nested in it run.
   *
   * A fixture nested in another one runs at the level of that fixture: given another level, it rejects.
   */
  isolation?: IsolationLevel
}

/** Test transactions and test fixtures of a database created with `test: true`. */
export interface TestHelpers {
  /**
   * Runs `callback` in a transaction that always rolls back.
   *
   * Wrap the body of every test in it, so that every run of the test gets its own transaction.
   * A query of the callback outside a transaction runs in a nested transaction of its own, so that a failed query undoes only itself, as in production.
   * Inside an existing transaction, it starts a nested transaction that always rolls back.
   */
  testTransaction<T>(callback: () => Promise<T>, options?: TestTransactionOptions): Promise<T>
  /**
   * Opens a test fixture for the tests of the current `describe` block or test file and runs `seed` in it, such as migrations or data shared by the tests.
   *
   * The fixture opens in the `before` hook and rolls back in the `after` hook.
   * The changes of `seed` stay for the test transactions that run while the fixture is open, and its result is the `data` of the fixture.
   * Test fixtures nest: a new one opens inside the innermost open one, and test transactions run in the innermost one.
   * A fixture whose `seed` rejects rolls back and closes.
   */
  useTestFixture<T>(seed: () => Promise<T>, options?: TestFixtureOptions): TestFixture<T>
  /**
   * Wraps the `test` function of `node:test` or `bun:test` so that every test it declares runs in a test transaction.
   *
   * The wrapped function keeps the modifiers of the original, such as `test.skip`, `test.only`, and `test.each(table)`, and its options, such as a timeout.
   * Without `onTestFinished` in the hooks, the test transaction takes the abort signal of the test context, such as `t.signal` of `node:test`.
   * Hooks of the test, such as `beforeEach`, run outside of its test transaction.
   * A test function must return a promise or a value rather than take a `done` callback.
   * With Vitest, run tests in test transactions with `aroundEach` instead, which also covers their hooks: the wrapper hides the parameters of a test function from the fixtures of `test.extend`.
   */
  wrapTest<T extends (...args: never[]) => unknown>(test: T): T
}

/** Creates the test helpers of a database created with `test: true`, registering fixtures with the hooks of a test runner. */
export function createTestHelpers(database: Database, hooks: TestHooks): TestHelpers {
  const coordinator = getCoordinator(database)
  if (!coordinator.test) {
    throw new Error("createTestHelpers requires a database created with test: true")
  }
  /**
   * Runs a test function in a test transaction, which `onTestFinished`, or else the signal of the test context, aborts once the runner finishes the test.
   *
   * The arguments of a test of `test.each` are a row of its table rather than a context, so its `signal` belongs to the data of the test.
   */
  function runTestInTransaction(callback: (...args: unknown[]) => unknown, parameterized: boolean) {
    return function (this: unknown, ...args: unknown[]) {
      const run = async () => callback.apply(this, args)
      if (!hooks.onTestFinished) {
        const signal = parameterized ? undefined : readTestSignal(args[0])
        return coordinator.testTransaction(run, { signal })
      }
      const controller = new AbortController()
      let finished = false
      hooks.onTestFinished(() => {
        finished = true
        // The level stops listening to the signal once the callback settles, so aborting after a test that has ended does nothing.
        controller.abort(new Error("The test finished before its test transaction ended"))
      })
      // A runner reports a rejection that comes after the test has finished, such as after a timeout, as an error between tests.
      return coordinator
        .testTransaction(run, { signal: controller.signal })
        .catch((error: unknown) => {
          if (!finished) {
            throw error
          }
        })
    }
  }
  return {
    testTransaction: (callback, options) => coordinator.testTransaction(callback, options),
    wrapTest: test => wrapTestFunction(test, undefined, false, runTestInTransaction),
    useTestFixture<T>(seed: () => Promise<T>, options?: TestFixtureOptions) {
      let pending: PendingTestFixture<T> | undefined
      let fixture: OpenedTestFixture<T> | undefined
      hooks.before(async () => {
        const current = coordinator.startTestFixture(seed, options)
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

/**
 * Opens a test fixture of a database created with `test: true` without the hooks of a test runner, such as in a server that runs browser tests, and runs `seed` in it.
 *
 * It resolves once `seed` resolves, with the fixture whose `close` rolls it back; a fixture whose `seed` rejects rolls back and closes.
 * Closing the database closes the fixture too.
 * Fixtures nest as with `useTestFixture`: a new one opens inside the innermost open one, and test transactions run in the innermost one.
 */
export function openTestFixture<T>(
  database: Database,
  seed: () => Promise<T>,
  options?: TestFixtureOptions,
): Promise<OpenedTestFixture<T>> {
  return getCoordinator(database).createTestFixture(seed, options)
}

/**
 * Opens a test transaction of a database created with `test: true` that callbacks share through `run` until it closes, such as the requests of one browser test to a server.
 *
 * Inside an open test fixture, it opens as a nested transaction of the innermost one, and rolls back a test transaction or another open test transaction running there; without a fixture, it opens on a connection of its own.
 * Closing the database closes it too.
 */
export function openTestTransaction(
  database: Database,
  options?: OpenTestTransactionOptions,
): Promise<OpenedTestTransaction> {
  return getCoordinator(database).openTestTransaction(options)
}

/** Reads the abort signal of a test from the first argument of its function, the test context of `node:test`. */
function readTestSignal(context: unknown): AbortSignal | undefined {
  if (typeof context === "object" && context !== null && "signal" in context) {
    const { signal } = context
    return signal instanceof AbortSignal ? signal : undefined
  }
  return undefined
}

/**
 * Wraps a `test` function of a test runner and the functions that its properties and calls return, such as `test.skip` and `test.each(table)`, replacing every function argument with `wrapCallback` of it.
 *
 * Calls a modifier with the object it was read from, since modifiers of `bun:test` reject another `this`.
 * Marks the callbacks of functions reached through `each` as parameterized.
 */
function wrapTestFunction<T extends object>(
  target: T,
  owner: object | undefined,
  parameterized: boolean,
  wrapCallback: (
    callback: (...args: unknown[]) => unknown,
    parameterized: boolean,
  ) => (...args: unknown[]) => unknown,
): T {
  return new Proxy(target, {
    apply(callee, self, args: unknown[]) {
      const wrappedArgs: unknown[] = []
      for (const arg of args) {
        wrappedArgs.push(
          typeof arg === "function"
            ? wrapCallback(arg as (...args: unknown[]) => unknown, parameterized)
            : arg,
        )
      }
      const result: unknown = Reflect.apply(callee as never, owner ?? self, wrappedArgs)
      return typeof result === "function"
        ? wrapTestFunction(result, undefined, parameterized, wrapCallback)
        : result
    },
    get(object, key) {
      const value: unknown = Reflect.get(object, key)
      return typeof value === "function"
        ? wrapTestFunction(value, object, parameterized || key === "each", wrapCallback)
        : value
    },
  })
}
