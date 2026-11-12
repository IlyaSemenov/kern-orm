// Ambient transactions and sessions of a database: routing of statements to the connection of the current level, transactions, sessions, advisory locks, test transactions, and closing.

import { AsyncLocalStorage } from "node:async_hooks"

import type {
  DatabaseOptions,
  PollLockOptions,
  SessionOptions,
  TransactionOptions,
} from "../database"
import type { Connection, Driver, DriverResult, SqlStatement } from "../driver"
import { ConnectionError } from "../driver-error"
import type {
  OpenedTestFixture,
  OpenedTestTransaction,
  OpenTestTransactionOptions,
  PendingTestFixture,
  TestFixtureOptions,
  TestTransactionOptions,
} from "../test-helpers"

import {
  createLockStatement,
  createTryLockStatement,
  isTaken,
  pollLock,
  SessionLocks,
} from "./advisory-lock"
import { TransactionConnectionError } from "./connection-loss"
import type { LevelOptions, Outcome, Rejection, TransactionLevel } from "./level"
import {
  closeStarting,
  createLevel,
  createUnavailableError,
  endLevel,
  getBeginStatement,
  getEndedOutcome,
  noLevelOptions,
  runLevel,
  runStarted,
  startNestedLevel,
  suppress,
  suppressAbortReason,
} from "./level"
import type { ReleaseErrorHandler } from "./release"
import { releaseConnection } from "./release"
import { createSessionLevel, releaseSession } from "./session"
import type { LevelSetting } from "./settings"
import { applySettings, getLevelSettings } from "./settings"
import { acquireUnlessAborted } from "./test-levels/abort"
import { TestFixtureStack } from "./test-levels/fixture-stack"
import { OpenTestTransactions } from "./test-levels/open-test-transaction"
import { runInTurn, runStatementInTurn, TurnQueue } from "./test-levels/turns"

/**
 * Routes statements and scripts to the ambient transaction or session of the current async context or to the pool.
 *
 * This is the only place that decides which connection executes a statement.
 */
export class TransactionCoordinator {
  readonly #storage = new AsyncLocalStorage<TransactionLevel>()
  readonly #fixtures: TestFixtureStack
  readonly #onReleaseError: ReleaseErrorHandler | undefined
  /** Closing of the database, set by the first `close`; from then on, operations outside a transaction reject. */
  #closed: Promise<void> | undefined
  readonly #openTestTransactions: OpenTestTransactions
  /** Rejects statements and transactions outside a test transaction or the seed of a test fixture instead of running them on the pool. */
  readonly test: boolean

  constructor(
    readonly driver: Driver,
    { test = false, onReleaseError }: Omit<DatabaseOptions, "driver"> = {},
  ) {
    this.test = test
    this.#onReleaseError = onReleaseError
    this.#fixtures = new TestFixtureStack(driver, this.#storage, onReleaseError)
    this.#openTestTransactions = new OpenTestTransactions(
      driver,
      this.#storage,
      this.#fixtures,
      onReleaseError,
    )
  }

  execute(statement: SqlStatement): Promise<DriverResult> {
    const level = this.#storage.getStore()
    if (level?.turns) {
      return runStatementInTurn(level, "execute a query", connection =>
        connection.execute(statement),
      )
    }
    const target = this.#route(level, "execute a query")
    return target instanceof Error ? Promise.reject(target) : target.execute(statement)
  }

  /** Executes a script of statements without parameters where `execute` executes a statement. */
  executeScript(text: string): Promise<void> {
    const level = this.#storage.getStore()
    if (level?.turns) {
      return runStatementInTurn(level, "execute a script", connection =>
        connection.executeScript(text),
      )
    }
    const target = this.#route(level, "execute a script")
    return target instanceof Error ? Promise.reject(target) : target.executeScript(text)
  }

  /** Returns the connection of the ambient transaction or session `level`, or the driver of the pool, that runs `operation`, or the error that rejects it. */
  #route(level: TransactionLevel | undefined, operation: string): Driver | Connection | Error {
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
   * Inside a transaction, it runs `callback` in a savepoint nested in it, which restores the settings it changed when it ends, and rejects without the savepoint when the isolation level of `options` differs from that of the transaction.
   * Inside a session, it starts the transaction on the connection of the session.
   * A failed cleanup after an error rejects with a `SuppressedError` that keeps the original error in its `suppressed` chain.
   * A transaction that it starts rolls back instead of `COMMIT` after a `ConnectionError` on its connection, and when it rejects after such an error, also of `COMMIT`, it rejects with `TransactionConnectionError` of the phase of the failure, whose `cause` is the error it would reject with otherwise.
   */
  transaction<T>(callback: () => Promise<T>, options?: TransactionOptions): Promise<T> {
    const levelOptions = options && {
      settings: getLevelSettings(options),
      isolation: options.isolation,
    }
    const parent = this.#storage.getStore()
    if (parent) {
      return parent.session
        ? this.#runInSession(parent, callback, levelOptions)
        : this.#runNested(parent, callback, true, levelOptions)
    }
    if (this.#closed) {
      return Promise.reject(createDatabaseClosedError("start a transaction"))
    }
    return this.test
      ? Promise.reject(new Error(describeOutsideTest("start a transaction")))
      : this.#runRoot(callback, true, levelOptions)
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
   * Tells whether a statement of the current async context runs in a transaction block of PostgreSQL: in a transaction, a test transaction, or the seed of a test fixture, but not in a session outside its transactions.
   *
   * Unlike `isInTransaction`, it counts the levels of the test helpers, since PostgreSQL rejects a statement such as `CREATE INDEX CONCURRENTLY` in any transaction block.
   */
  isInTransactionBlock(): boolean {
    const level = this.#storage.getStore()
    return level !== undefined && !level.session
  }

  /**
   * Runs `callback` in a session: on one reserved connection outside a transaction, with the settings of `options` until it ends.
   *
   * Statements of the callback run on the connection, each in a transaction of its own, and `transaction` starts a transaction on it.
   * It rejects without calling `callback` inside a transaction, a test transaction, or another session, and on a coordinator created for tests, whose statements all run in test transactions.
   * A rejection of `callback` undoes nothing.
   * After a `ConnectionError` on its connection, the session accepts no more statements.
   */
  session<T>(callback: () => Promise<T>, options?: SessionOptions): Promise<T> {
    const parent = this.#storage.getStore()
    if (parent) {
      return Promise.reject(
        new Error(
          parent.session
            ? "Cannot start a session inside a session"
            : "Cannot start a session inside a transaction, also a test transaction: the statements of a session run outside a transaction",
        ),
      )
    }
    if (this.#closed) {
      return Promise.reject(createDatabaseClosedError("start a session"))
    }
    if (this.test) {
      return Promise.reject(
        new Error(
          "Cannot start a session: the database was created with test: true, so its statements run in test transactions, and the statements of a session run outside a transaction",
        ),
      )
    }
    return this.#runSession(callback, getLevelSettings(options))
  }

  /**
   * Takes the advisory lock of `key` until the transaction of `transaction` ends, waiting while another transaction or session holds it.
   *
   * It rejects without a statement outside such a transaction, where the lock would end with its statement, and in a session outside its transactions, where the waiting statement keeps a snapshot that `CREATE INDEX CONCURRENTLY` in the session that holds the lock waits for.
   */
  async lock(key: string): Promise<void> {
    const level = this.#storage.getStore()
    if (!level?.inTransaction) {
      throw new Error(
        level?.session
          ? "Cannot wait for an advisory lock in a session outside a transaction: the waiting statement would keep a snapshot that CREATE INDEX CONCURRENTLY in the session holding the lock waits for; take it with tryLock, which does not wait"
          : "Cannot take an advisory lock outside a transaction, where it would end with its statement; a test transaction alone does not count",
      )
    }
    await this.execute(createLockStatement(key))
  }

  /**
   * Takes the advisory lock of `key` unless another transaction or session holds it, and tells whether it took it: until the transaction of `transaction` ends, or in a session outside its transactions, until the session ends.
   *
   * It rejects without a statement outside both, where the lock would end with its statement.
   * A session takes a key that it holds without a statement, and releases its locks when it ends.
   */
  async tryLock(key: string): Promise<boolean> {
    const level = this.#storage.getStore()
    if (level?.inTransaction) {
      return isTaken(await this.execute(createTryLockStatement(key)))
    }
    if (!level?.session) {
      throw new Error(
        "Cannot take an advisory lock outside a transaction or a session, where it would end with its statement; a test transaction alone does not count",
      )
    }
    const unavailable = createUnavailableError(level, "take an advisory lock")
    if (unavailable) {
      throw unavailable
    }
    return (level.locks ??= new SessionLocks()).take(level.connection, key)
  }

  /**
   * Takes the advisory lock of `key` in a session outside its transactions until the session ends, calling `tryLock` again after a pause until it takes the lock.
   *
   * It rejects without a statement outside a session, and in a transaction, also of a session or of the test helpers, which would keep a snapshot between the attempts; in a transaction of `transaction`, `lock` waits for the lock instead.
   * Once `signal` of `options` aborts, it makes no more attempts and rejects with its reason, unless the attempt that is running takes the lock.
   */
  async pollLock(key: string, options?: PollLockOptions): Promise<void> {
    const level = this.#storage.getStore()
    if (!level?.session) {
      throw new Error(
        !level
          ? "Cannot poll for an advisory lock outside a session, where it would end with its statement"
          : level.inTransaction
            ? "Cannot poll for an advisory lock in a transaction, which would keep a snapshot between the attempts; take it with lock, which waits for it"
            : "Cannot poll for an advisory lock in a test transaction, which would keep a snapshot between the attempts; take it with lock inside transaction or ensureTransaction",
      )
    }
    await pollLock(() => this.tryLock(key), options?.signal)
  }

  /**
   * Runs `callback` in a transaction that always rolls back, on a coordinator created for tests.
   *
   * Inside a transaction, it runs `callback` in a savepoint nested in it that always rolls back.
   * Outside a transaction of `transaction`, the statements and nested levels of `callback` take turns on its connection, each statement in a savepoint of its own, see `runInTurn`; when `callback` resolves, the level ends after the statements and nested levels it started.
   * When `signal` aborts, the level stops accepting statements at once and ends without waiting for `callback`.
   * Once the level ends, the transaction rejects with the reason of the signal.
   * A failure to start or end the level after the abort suppresses the reason in a `SuppressedError`.
   * Aborted while it waits for its turn in the fixture stack or for a connection, it rejects at once; after the abort, it never calls `callback`.
   */
  testTransaction<T>(callback: () => Promise<T>, options?: TestTransactionOptions): Promise<T> {
    const signal = options?.signal
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
      return this.#runNested(parent, callback, false, options)
    }
    if (this.#closed) {
      return Promise.reject(createDatabaseClosedError("start a test transaction"))
    }
    return this.#fixtures.startTestLevel(options).then(level => {
      if (!level) {
        return this.#runRoot(callback, false, options)
      }
      level.turns = new TurnQueue()
      return runStarted(this.#storage, level, callback, false, signal)
    })
  }

  /**
   * Opens a test transaction that the callbacks of `run` share until it closes, see `OpenTestTransactions`.
   *
   * It rejects inside a transaction, and once closing the database is requested.
   */
  async openTestTransaction(options?: OpenTestTransactionOptions): Promise<OpenedTestTransaction> {
    if (!this.test) {
      throw new Error("openTestTransaction requires a database created with test: true")
    }
    // Late code of a finished level must not open a test transaction that outlives it.
    if (this.#storage.getStore()) {
      throw new Error("Cannot open a test transaction inside a transaction")
    }
    const getClosedError = () =>
      this.#closed ? createDatabaseClosedError("open a test transaction") : undefined
    const closedError = getClosedError()
    if (closedError) {
      throw closedError
    }
    return this.#openTestTransactions.open(options, getClosedError)
  }

  /**
   * Opens a test fixture: a transaction on a reserved connection, or a savepoint in the innermost open fixture, and runs `seed` in it.
   *
   * Test transactions started outside any transaction run in the innermost fixture.
   * A fixture whose `seed` rejects rolls back and closes.
   */
  createTestFixture<T>(
    seed: () => Promise<T>,
    options?: TestFixtureOptions,
  ): Promise<OpenedTestFixture<T>> {
    return this.startTestFixture(seed, options).fixture
  }

  /**
   * Starts opening a test fixture, see `createTestFixture`, and returns it with a `close` that can be called before it opens.
   *
   * Closing before the fixture opens rejects the opening without waiting for `seed` and rolls the fixture back, so a fixture or test transaction started after `close` never nests in it, even when its `seed` never settles.
   * Closing an open fixture also closes the fixtures opening in it.
   */
  startTestFixture<T>(seed: () => Promise<T>, options?: TestFixtureOptions): PendingTestFixture<T> {
    return this.#fixtures.start(seed, this.#getFixtureRefusal(), options)
  }

  /** Returns the error that rejects a test fixture created now, or `undefined` when it can open. */
  #getFixtureRefusal(): Error | undefined {
    if (!this.test) {
      return new Error("openTestFixture requires a database created with test: true")
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
   * Closes the test fixtures, including those still opening, and the open test transactions on connections of their own, and then the driver, which waits for the running transactions and sessions to end.
   *
   * A driver waits for every reserved connection, so closing it under an open fixture or test transaction would wait forever.
   * A failed closing of the driver suppresses the failures of closing the fixtures and test transactions.
   * From the first call, statements, transactions, sessions, and fixtures started outside a transaction and a session reject, while the levels already running can still end; a repeated call returns the same closing.
   */
  close(): Promise<void> {
    // A transaction or a session keeps its connection until it ends, so closing inside it would wait for itself.
    const level = this.#storage.getStore()
    if (level) {
      return Promise.reject(
        new Error(
          `Cannot close the database inside a ${level.session ? "session" : "transaction"}`,
        ),
      )
    }
    this.#closed ??= this.#close()
    return this.#closed
  }

  /** Closes the test fixtures and the open test transactions on connections of their own, and then the driver, see `close`. */
  async #close(): Promise<void> {
    let rejection: Rejection | undefined
    for (const closing of await Promise.allSettled([
      this.#fixtures.close(),
      this.#openTestTransactions.close(),
    ])) {
      if (closing.status === "rejected") {
        rejection = suppress(
          closing.reason,
          rejection,
          "Closing a test fixture or transaction failed",
        )
      }
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
    options: LevelOptions = noLevelOptions,
  ): Promise<T> {
    const { signal } = options
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
    const level = createLevel(connection, undefined, commits, options.isolation)
    if (!commits) {
      level.turns = new TurnQueue()
    }
    const outcome = await this.#runTransaction(level, callback, commits, options)
    await releaseConnection(connection, this.#onReleaseError)
    return settleTransaction(level, outcome)
  }

  /**
   * Runs `callback` in a transaction of `transaction` on the connection of `session`, which rejects its own statements until the transaction ends.
   *
   * A transaction whose connection fails rejects with `TransactionConnectionError`, as one on a connection of its own does.
   */
  async #runInSession<T>(
    session: TransactionLevel,
    callback: () => Promise<T>,
    options: LevelOptions = noLevelOptions,
  ): Promise<T> {
    const unavailable = createUnavailableError(session, "start a transaction")
    if (unavailable) {
      throw unavailable
    }
    // Reserving the level before BEGIN is sent keeps statements of the session from running inside its transaction.
    const level = createLevel(session.connection, session, true, options.isolation)
    session.child = level
    return settleTransaction(level, await this.#runTransaction(level, callback, true, options))
  }

  /**
   * Begins the transaction of `level`, a level that is not a savepoint, applies the settings of `options`, runs `callback` in it, and ends it.
   *
   * A level whose `BEGIN` fails closes, and one whose settings fail rolls back.
   */
  async #runTransaction<T>(
    level: TransactionLevel,
    callback: () => Promise<T>,
    commits: boolean,
    { signal, settings, isolation }: LevelOptions,
  ): Promise<Outcome<T>> {
    try {
      await level.connection.execute(getBeginStatement(isolation))
    } catch (error) {
      if (level.cleanup) {
        // Its session ended while BEGIN was running and started its cleanup.
        return getEndedOutcome(level.cleanup, error)
      }
      closeStarting(level)
      return { rejection: { error: suppressAbortReason(error, signal) } }
    }
    if (settings) {
      try {
        await applySettings(level, settings)
      } catch (error) {
        return getEndedOutcome(endLevel(level, false), error)
      }
    }
    if (level.watch) {
      level.watch.phase = "transaction"
    }
    return runLevel(this.#storage, level, callback, commits, signal)
  }

  /**
   * Runs `callback` in a session with `settings` on a connection of its own, and restores the settings before the connection returns to the driver.
   *
   * A session whose settings fail to apply rejects without calling `callback`.
   */
  async #runSession<T>(
    callback: () => Promise<T>,
    settings: readonly LevelSetting[] | undefined,
  ): Promise<T> {
    const level = createSessionLevel(await this.driver.acquire())
    let outcome: Outcome<T> | undefined
    if (settings) {
      try {
        await applySettings(level, settings)
      } catch (error) {
        level.state = "closed"
        outcome = { rejection: { error } }
      }
    }
    outcome ??= await runLevel(this.#storage, level, callback, false)
    await releaseSession(level, this.#onReleaseError)
    if (outcome.rejection) {
      throw outcome.rejection.error
    }
    return outcome.result as T
  }

  async #runNested<T>(
    parent: TransactionLevel,
    callback: () => Promise<T>,
    commits: boolean,
    options?: LevelOptions,
  ): Promise<T> {
    const start = async () => {
      const level = await startNestedLevel(parent, commits, options)
      // A nested test transaction outside a transaction of the code under test emulates the pool as its parent does.
      if (!level.inTransaction) {
        level.turns = new TurnQueue()
      }
      return runStarted(this.#storage, level, callback, commits, options?.signal)
    }
    if (parent.turns) {
      return runInTurn(parent, "start a nested transaction", start, options?.signal)
    }
    const unavailable = createUnavailableError(parent, "start a nested transaction")
    if (unavailable) {
      throw unavailable
    }
    return start()
  }
}

/**
 * Returns the result of the `outcome` of a transaction of `level`, a level that is not a savepoint, or throws its rejection.
 *
 * A failure of the connection decides whether the transaction may have been committed, whatever error the rejection has, so the transaction then rejects with `TransactionConnectionError` of its phase.
 */
function settleTransaction<T>(level: TransactionLevel, outcome: Outcome<T>): T {
  const { rejection } = outcome
  if (rejection) {
    const failure = level.watch?.failure
    throw failure
      ? new TransactionConnectionError(failure.phase, { cause: rejection.error })
      : rejection.error
  }
  return outcome.result as T
}

/** Error message of an operation outside a test transaction on a coordinator created for tests. */
function describeOutsideTest(operation: string): string {
  return `Cannot ${operation} outside a test transaction: the database was created with test: true, so wrap the test in testTransaction`
}

/** Error of `operation` started outside a transaction after closing the database was requested. */
function createDatabaseClosedError(operation: string): Error {
  return new Error(`Cannot ${operation}: the database is closed`)
}
