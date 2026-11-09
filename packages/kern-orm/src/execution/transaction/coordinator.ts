// Ambient transactions of a database: routing of statements to the connection of the current level, transactions, test transactions, and closing.

import { AsyncLocalStorage } from "node:async_hooks"

import type { DatabaseOptions, TransactionOptions } from "../database"
import type { Connection, Driver, DriverResult, SqlStatement } from "../driver"
import { ConnectionError } from "../driver-error"
import type { OpenedTestFixture, PendingTestFixture, TestTransactionOptions } from "../testing"

import { acquireUnlessAborted } from "./abort"
import { TransactionConnectionError } from "./connection-loss"
import { TestFixtureStack } from "./fixture-stack"
import type { Outcome, Rejection, TransactionLevel } from "./level"
import {
  beginStatement,
  createLevel,
  createUnavailableError,
  endLevel,
  getEndedOutcome,
  runLevel,
  startNestedLevel,
  suppress,
  suppressAbortReason,
} from "./level"
import type { ReleaseErrorHandler } from "./release"
import { releaseConnection } from "./release"
import type { LevelSetting } from "./settings"
import { applySettings, getLevelSettings } from "./settings"

/**
 * Routes statements and scripts to the ambient transaction of the current async context or to the pool.
 *
 * This is the only place that decides which connection executes a statement.
 */
export class TransactionCoordinator {
  readonly #storage = new AsyncLocalStorage<TransactionLevel>()
  readonly #fixtures: TestFixtureStack
  readonly #onReleaseError: ReleaseErrorHandler | undefined
  /** Closing of the database, set by the first `close`; from then on, operations outside a transaction reject. */
  #closed: Promise<void> | undefined
  /** Rejects statements and transactions outside a test transaction or the seed of a test fixture instead of running them on the pool. */
  readonly test: boolean

  constructor(
    readonly driver: Driver,
    { test = false, onReleaseError }: Omit<DatabaseOptions, "driver"> = {},
  ) {
    this.test = test
    this.#onReleaseError = onReleaseError
    this.#fixtures = new TestFixtureStack(driver, this.#storage, onReleaseError)
  }

  execute(statement: SqlStatement): Promise<DriverResult> {
    const target = this.#route("execute a query")
    return target instanceof Error ? Promise.reject(target) : target.execute(statement)
  }

  /** Executes a script of statements without parameters where `execute` executes a statement. */
  executeScript(text: string): Promise<void> {
    const target = this.#route("execute a script")
    return target instanceof Error ? Promise.reject(target) : target.executeScript(text)
  }

  /** Returns the connection of the ambient transaction or the driver of the pool that runs `operation`, or the error that rejects it. */
  #route(operation: string): Driver | Connection | Error {
    const level = this.#storage.getStore()
    if (!level) {
      if (this.#closed) {
        return createDatabaseClosedError(operation)
      }
      return this.test ? new Error(describeOutsideTest(operation)) : this.driver
    }
    // Late async work of a finished level must fail rather than run in another level or on the pool.
    return createUnavailableError(level, operation) ?? level.connection
  }

  /**
   * Runs `callback` in a transaction that commits when it resolves and rolls back when it rejects, with the settings of `options`.
   *
   * Inside a transaction, it runs `callback` in a savepoint nested in it, which restores the settings it changed when it ends.
   * A failed cleanup after an error rejects with a `SuppressedError` that keeps the original error in its `suppressed` chain.
   * A transaction that it starts rolls back instead of `COMMIT` after a `ConnectionError` on its connection, and when it rejects after such an error, also of `COMMIT`, it rejects with `TransactionConnectionError` of the phase of the failure, whose `cause` is the error it would reject with otherwise.
   */
  transaction<T>(callback: () => Promise<T>, options?: TransactionOptions): Promise<T> {
    const settings = getLevelSettings(options)
    const parent = this.#storage.getStore()
    if (parent) {
      return this.#runNested(parent, callback, true, undefined, settings)
    }
    if (this.#closed) {
      return Promise.reject(createDatabaseClosedError("start a transaction"))
    }
    return this.test
      ? Promise.reject(new Error(describeOutsideTest("start a transaction")))
      : this.#runRoot(callback, true, undefined, settings)
  }

  /**
   * Runs `callback` in the current transaction, or in a new transaction outside of one.
   *
   * Joining starts no savepoint, so a rejection of `callback` does not undo its changes.
   * It rejects without calling `callback` when the current level accepts no statements, as a nested transaction would.
   */
  async ensureTransaction<T>(callback: () => Promise<T>): Promise<T> {
    const level = this.#storage.getStore()
    if (!level?.inTransaction) {
      return this.transaction(callback)
    }
    // Late code of a finished level must not run its side effects as if in the transaction.
    const unavailable = createUnavailableError(level, "join the transaction")
    if (unavailable) {
      throw unavailable
    }
    return callback()
  }

  /**
   * Tells whether the current async context runs in a transaction of `transaction`.
   *
   * A test transaction and the seed of a test fixture are not transactions, unless they run inside one, so that code under test behaves as in production.
   */
  isInTransaction(): boolean {
    return this.#storage.getStore()?.inTransaction ?? false
  }

  /**
   * Runs `callback` in a transaction that always rolls back, on a coordinator created for tests.
   *
   * Inside a transaction, it runs `callback` in a savepoint nested in it that always rolls back.
   * When `signal` aborts, the level stops accepting statements at once and ends without waiting for `callback`.
   * Once the level ends, the transaction rejects with the reason of the signal.
   * A failure to start or end the level after the abort suppresses the reason in a `SuppressedError`.
   * Aborted while it waits for its turn in the fixture stack or for a connection, it rejects at once; after the abort, it never calls `callback`.
   */
  testTransaction<T>(
    callback: () => Promise<T>,
    { signal }: TestTransactionOptions = {},
  ): Promise<T> {
    if (!this.test) {
      return Promise.reject(
        new Error("testTransaction requires a database created with test: true"),
      )
    }
    if (signal?.aborted) {
      return Promise.reject(signal.reason)
    }
    const parent = this.#storage.getStore()
    if (parent) {
      return this.#runNested(parent, callback, false, signal)
    }
    if (this.#closed) {
      return Promise.reject(createDatabaseClosedError("start a test transaction"))
    }
    return this.#fixtures
      .startTestLevel(signal)
      .then(level =>
        level
          ? this.#runStarted(level, callback, false, signal)
          : this.#runRoot(callback, false, signal),
      )
  }

  /**
   * Opens a test fixture: a transaction on a reserved connection, or a savepoint in the innermost open fixture, and runs `seed` in it.
   *
   * Test transactions started outside any transaction run in the innermost fixture.
   * A fixture whose `seed` rejects rolls back and closes.
   */
  createTestFixture<T>(seed: () => Promise<T>): Promise<OpenedTestFixture<T>> {
    return this.startTestFixture(seed).fixture
  }

  /**
   * Starts opening a test fixture, see `createTestFixture`, and returns it with a `close` that can be called before it opens.
   *
   * Closing before the fixture opens rejects the opening without waiting for `seed` and rolls the fixture back, so a fixture or test transaction started after `close` never nests in it, even when its `seed` never settles.
   * Closing an open fixture also closes the fixtures opening in it.
   */
  startTestFixture<T>(seed: () => Promise<T>): PendingTestFixture<T> {
    return this.#fixtures.start(seed, this.#getFixtureRefusal())
  }

  /** Returns the error that rejects a test fixture created now, or `undefined` when it can open. */
  #getFixtureRefusal(): Error | undefined {
    if (!this.test) {
      return new Error("createTestFixture requires a database created with test: true")
    }
    // Late code of a finished level must not reach the fixture stack.
    if (this.#storage.getStore()) {
      return new Error("Cannot create a test fixture inside a transaction")
    }
    // Closing the database closes only the fixtures that exist when it is requested.
    if (this.#closed) {
      return createDatabaseClosedError("create a test fixture")
    }
    return undefined
  }

  /**
   * Closes the test fixtures, including those still opening, and then the driver, which waits for the running transactions to end.
   *
   * A driver waits for every reserved connection, so closing it under an open fixture would wait forever.
   * A failed closing of the driver suppresses the failures of closing the fixtures.
   * From the first call, statements, transactions, and fixtures started outside a transaction reject, while the levels already running can still end; a repeated call returns the same closing.
   */
  close(): Promise<void> {
    // A transaction keeps its connection until it ends, so closing inside it would wait for itself.
    if (this.#storage.getStore()) {
      return Promise.reject(new Error("Cannot close the database inside a transaction"))
    }
    this.#closed ??= this.#close()
    return this.#closed
  }

  /** Closes the test fixtures and then the driver, see `close`. */
  async #close(): Promise<void> {
    let rejection: Rejection | undefined
    try {
      await this.#fixtures.close()
    } catch (error) {
      rejection = { error }
    }
    try {
      await this.driver.close()
    } catch (error) {
      rejection = suppress(error, rejection, "Closing the driver failed")
    }
    if (rejection) {
      throw rejection.error
    }
  }

  /**
   * Runs `callback` in a level without a parent on a connection of its own: a transaction of `transaction` when it `commits`, and a test transaction otherwise.
   *
   * A transaction of `transaction` whose connection fails rejects with `TransactionConnectionError`.
   */
  async #runRoot<T>(
    callback: () => Promise<T>,
    commits: boolean,
    signal?: AbortSignal,
    settings?: readonly LevelSetting[],
  ): Promise<T> {
    let connection: Connection
    try {
      connection = await (signal
        ? acquireUnlessAborted(this.driver, signal, this.#onReleaseError)
        : this.driver.acquire())
    } catch (error) {
      throw commits && error instanceof ConnectionError
        ? new TransactionConnectionError("begin", { cause: error })
        : error
    }
    // An abort that comes while the connection is handed over starts nothing either.
    if (signal?.aborted) {
      await releaseConnection(connection, this.#onReleaseError)
      throw signal.reason
    }
    // A level that commits is a transaction of `transaction`; test transactions roll back.
    const level = createLevel(connection, undefined, commits)
    const { watch } = level
    let outcome: Outcome<T> | undefined
    try {
      await level.connection.execute(beginStatement)
    } catch (error) {
      level.state = "closed"
      outcome = { rejection: { error: suppressAbortReason(error, signal) } }
    }
    if (!outcome && settings) {
      try {
        await applySettings(level, settings)
      } catch (error) {
        outcome = await getEndedOutcome(endLevel(level, false), error)
      }
    }
    if (!outcome) {
      if (watch) {
        watch.phase = "transaction"
      }
      outcome = await runLevel(this.#storage, level, callback, commits, signal)
    }
    await releaseConnection(connection, this.#onReleaseError)
    if (outcome.rejection) {
      // A failure of the connection decides whether the transaction may have been committed, whatever error the rejection has.
      throw watch?.failure
        ? new TransactionConnectionError(watch.failure.phase, { cause: outcome.rejection.error })
        : outcome.rejection.error
    }
    return outcome.result as T
  }

  async #runNested<T>(
    parent: TransactionLevel,
    callback: () => Promise<T>,
    commits: boolean,
    signal?: AbortSignal,
    settings?: readonly LevelSetting[],
  ): Promise<T> {
    const unavailable = createUnavailableError(parent, "start a nested transaction")
    if (unavailable) {
      throw unavailable
    }
    return this.#runStarted(
      await startNestedLevel(parent, commits, signal, settings),
      callback,
      commits,
      signal,
    )
  }

  /** Runs `callback` in a started level, returning its result or throwing its rejection. */
  async #runStarted<T>(
    level: TransactionLevel,
    callback: () => Promise<T>,
    commits: boolean,
    signal?: AbortSignal,
  ): Promise<T> {
    const { result, rejection } = await runLevel(this.#storage, level, callback, commits, signal)
    if (rejection) {
      throw rejection.error
    }
    return result as T
  }
}

/** Error message of an operation outside a test transaction on a coordinator created for tests. */
function describeOutsideTest(operation: string): string {
  return `Cannot ${operation} outside a test transaction: the database was created with test: true, so wrap the test in testTransaction`
}

/** Error of `operation` started outside a transaction after closing the database was requested. */
function createDatabaseClosedError(operation: string): Error {
  return new Error(`Cannot ${operation}: the database is closed`)
}
