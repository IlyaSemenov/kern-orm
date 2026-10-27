import { AsyncLocalStorage } from "node:async_hooks"

import type { Connection, Driver, DriverResult, SqlStatement, TransactionFailure } from "./driver"
import { createStatement } from "./driver"
import type { OpenedTestFixture, PendingTestFixture } from "./testing"

/** Transaction or savepoint nested in it, run by one callback in its own async context, or a test fixture without a context. */
interface TransactionLevel {
  readonly connection: Connection
  readonly parent: TransactionLevel | undefined
  /** Number of enclosing levels, which names the savepoint of a nested level. */
  readonly depth: number
  /** A level accepts statements only while `open`; it is `starting` until its `BEGIN` or `SAVEPOINT` completes. */
  state: "starting" | "open" | "closing" | "closed"
  /** Active nested level, reserved before its `SAVEPOINT` is sent. */
  child: TransactionLevel | undefined
  /** Failure to end a nested level: the statement may not have reached PostgreSQL, so this level can only roll back. */
  rollbackOnly: Rejection | undefined
  /** The single cleanup of the level, started by whoever ends it first. */
  cleanup: Promise<Cleanup> | undefined
  /** Why another level ended this one, which its rejection reports. */
  endedBy: "enclosing level" | "preemption" | undefined
}

/** Error to reject with; a later cleanup error suppresses it instead of replacing it. */
interface Rejection {
  readonly error: unknown
}

/** Result of ending a level. */
interface Cleanup {
  readonly rejection?: Rejection
  /** Failure of the `COMMIT` or `ROLLBACK` of a transaction, which may leave it open on its connection. */
  readonly failure?: TransactionFailure
}

/** Result of running the callback of a level and ending the level. */
interface Outcome<T> extends Cleanup {
  readonly result?: T
}

/**
 * Routes statements to the ambient transaction of the current async context or to the pool.
 *
 * This is the only place that decides which connection executes a statement.
 */
export class TransactionCoordinator {
  readonly #storage = new AsyncLocalStorage<TransactionLevel>()
  /** Open test fixtures, the innermost last. */
  readonly #fixtures: TransactionLevel[] = []
  /** Changes of the fixture stack, run one after another so that each one sees the stack the previous one left. */
  #transitions: Promise<unknown> = Promise.resolve()
  /**
   * The `close` functions of the test fixtures that are still opening, from the call that starts the opening until the fixture enters the stack or the opening ends otherwise.
   *
   * An opening holds the queue of the fixture stack while its seed runs, so a closing of the stack queued behind it would wait for a seed that may never settle.
   * Closing the stack therefore calls these first: each one tells its opening to stop waiting for the seed.
   */
  readonly #openings = new Set<() => Promise<void>>()
  /**
   * Outermost fixture in the stack whose closing is queued but has not finished.
   *
   * Openings that start after that closing is requested nest outside of the fixture once it closes, so a repeated closing of it, or a closing of a fixture nested in it, must not close them.
   */
  #closing: TransactionLevel | undefined
  /** Closing of the database, set by the first `close`; from then on, operations outside a transaction reject. */
  #closed: Promise<void> | undefined

  constructor(
    readonly driver: Driver,
    /** Rejects statements and transactions outside a test transaction or the seed of a test fixture instead of running them on the pool. */
    readonly test = false,
  ) {}

  execute(statement: SqlStatement): Promise<DriverResult> {
    const level = this.#storage.getStore()
    if (!level) {
      if (this.#closed) {
        return Promise.reject(createDatabaseClosedError("execute a query"))
      }
      return this.test
        ? Promise.reject(new Error(describeOutsideTest("execute a query")))
        : this.driver.execute(statement)
    }
    // Late async work of a finished level must fail rather than run in another level or on the pool.
    const unavailable = createUnavailableError(level, "execute a query")
    if (unavailable) {
      return Promise.reject(unavailable)
    }
    return level.connection.execute(statement)
  }

  /**
   * Runs `callback` in a transaction that commits when it resolves and rolls back when it rejects.
   *
   * Inside a transaction, it runs `callback` in a savepoint nested in it.
   * A failed cleanup after an error rejects with a `SuppressedError` that keeps the original error in its `suppressed` chain.
   */
  transaction<T>(callback: () => Promise<T>): Promise<T> {
    const parent = this.#storage.getStore()
    if (parent) {
      return this.#runNested(parent, callback, true)
    }
    if (this.#closed) {
      return Promise.reject(createDatabaseClosedError("start a transaction"))
    }
    return this.test
      ? Promise.reject(new Error(describeOutsideTest("start a transaction")))
      : this.#runRoot(callback, true)
  }

  /**
   * Runs `callback` in a transaction that always rolls back, on a coordinator created for tests.
   *
   * Inside a transaction, it runs `callback` in a savepoint nested in it that always rolls back.
   */
  testTransaction<T>(callback: () => Promise<T>): Promise<T> {
    if (!this.test) {
      return Promise.reject(
        new Error("testTransaction requires a database created with test: true"),
      )
    }
    const parent = this.#storage.getStore()
    if (parent) {
      return this.#runNested(parent, callback, false)
    }
    if (this.#closed) {
      return Promise.reject(createDatabaseClosedError("start a test transaction"))
    }
    return this.#enqueue(() => {
      const fixture = this.#fixtures.at(-1)
      return fixture && this.#startInFixture(fixture)
    }).then(level =>
      level ? this.#runStarted(level, callback, false) : this.#runRoot(callback, false),
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
    // A fixture goes through these stages, and `close` can be called at any of them:
    // 1. Queued: its opening waits in the queue of the fixture stack. Closing skips the opening.
    // 2. Starting: its BEGIN, or its SAVEPOINT in the innermost fixture, runs. Closing rolls it back once it starts.
    // 3. Seeding: `seed` runs in a savepoint of its own. Closing stops waiting for `seed` and rolls back both levels.
    // 4. Open: it is in the stack, and test transactions and later fixtures nest in it. Closing rolls it back with everything nested in it.
    // An opening that does not reach stage 4 rejects `fixture`; when closing was requested, it rejects with "closed before it opened", and `close` reports the failures of the opening instead, since the before hook of `useTestFixture` ignores that rejection.

    // The level of the fixture, set once it is open; a fixture that never opens leaves it unset.
    let level: TransactionLevel | undefined
    // Set by the first `close`, and checked by the opening between its steps.
    let closeRequested = false
    // Resolved by the first `close`, so that the opening stops waiting for `seed`.
    const closing = Promise.withResolvers<void>()
    // A failure of an opening that ended after closing was requested, which the first queued closing reports.
    let closedRejection: Rejection | undefined
    const close = () => {
      // A seed waits in the queue for its own end, so closing from inside it would wait forever.
      if (this.#storage.getStore()) {
        return Promise.reject(new Error("Cannot close a test fixture inside a transaction"))
      }
      closeRequested = true
      closing.resolve()
      if (level && this.#fixtures.includes(level)) {
        // Stage 4: close the open fixture as a change of the stack.
        const opened = level
        // The queued closing of this fixture or an enclosing one already closes the openings in it, and later openings open outside of it.
        if (this.#closing && this.#closing.depth <= opened.depth) {
          return this.#enqueue(() => this.#closeFixture(opened))
        }
        this.#closing = opened
        // The openings started before this call are queued before this closing, so they open in this fixture or in a fixture nested in it.
        return this.#closeAfterOpenings(() =>
          this.#enqueue(async () => {
            try {
              await this.#closeFixture(opened)
            } finally {
              // A closing of an enclosing fixture requested meanwhile has replaced it and clears it itself.
              if (this.#closing === opened) {
                this.#closing = undefined
              }
            }
          }),
        )
      }
      // Stages 1 to 3, or a fixture already closed: the opening ends on its own after `closeRequested`, without entering the stack, and this closing, queued after it, reports how it ended.
      return this.#enqueue(() => {
        // Only the first closing reports the failure; a repeated one resolves.
        const rejection = closedRejection
        closedRejection = undefined
        if (rejection) {
          throw rejection.error
        }
      })
    }
    if (!this.test) {
      return {
        fixture: Promise.reject(
          new Error("createTestFixture requires a database created with test: true"),
        ),
        close,
      }
    }
    // Late code of a finished level must not reach the fixture stack.
    if (this.#storage.getStore()) {
      return {
        fixture: Promise.reject(new Error("Cannot create a test fixture inside a transaction")),
        close,
      }
    }
    // Closing the database closes only the fixtures that exist when it is requested.
    if (this.#closed) {
      return { fixture: Promise.reject(createDatabaseClosedError("create a test fixture")), close }
    }
    /**
     * Runs stages 2 and 3 of the fixture and puts it in the stack, returning `undefined` when closing was requested and the fixture rolled back cleanly.
     *
     * It rejects with a failure to start the fixture, with the rejection of `seed`, or with a failure to roll back, which suppresses the rejection of `seed`.
     */
    const open = async (): Promise<OpenedTestFixture<T> | undefined> => {
      // Stage 1: starting a fixture closed while queued would preempt the active level of its parent for nothing.
      if (closeRequested) {
        return undefined
      }
      // Stage 2.
      const parent = this.#fixtures.at(-1)
      const started = parent ? await this.#startInFixture(parent) : await this.#beginFixture()
      // A fixture has no callback and no context: it stays open until it is closed.
      started.state = "open"
      // Stage 3: `outcome` is `undefined` when closing won the race, while `seed` may still run, and possibly never settle.
      // The rollback below ends the level of the seed as a level nested in the fixture, so the later statements of `seed` fail, and its outcome is ignored.
      const outcome = closeRequested
        ? undefined
        : await Promise.race([this.#seedFixture(started, seed), closing.promise])
      // Stage 4, unless the seed rejected or closing was requested, even after the seed resolved.
      if (outcome && !outcome.rejection && !closeRequested) {
        this.#fixtures.push(started)
        level = started
        // From here `close` closes the fixture in the stack, so it must not be called again as the closing of an opening.
        this.#openings.delete(close)
        const { result } = outcome
        return {
          get data() {
            // The data becomes unavailable when the cleanup of the fixture starts, including one started by an enclosing fixture.
            if (started.state !== "open") {
              throw new Error("Test fixture is closed")
            }
            return result as T
          },
          close,
          [Symbol.asyncDispose]: close,
        }
      }
      const rejection = combineRejections(outcome?.rejection, {
        rejection: await this.#endFixture(started),
      })
      if (rejection) {
        throw rejection.error
      }
      return undefined
    }
    this.#openings.add(close)
    // The whole opening is one change of the stack, so that no other change sees a fixture that is starting or seeding.
    const fixture = this.#enqueue(async (): Promise<OpenedTestFixture<T>> => {
      let opened: OpenedTestFixture<T> | undefined
      try {
        opened = await open()
      } catch (error) {
        if (!closeRequested) {
          throw error
        }
        // The before hook of useTestFixture ignores the rejection of an opening that its after hook closed, so the closing reports the failure.
        closedRejection = { error }
      } finally {
        this.#openings.delete(close)
      }
      if (!opened) {
        throw new Error("Test fixture was closed before it opened")
      }
      return opened
    })
    return { fixture, close }
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
      // Unlike closing a fixture, closing the database closes every opening, including one started after a closing of the stack was requested, since nothing may stay open.
      // Closing the first fixture closes the whole stack.
      await this.#closeAfterOpenings(() =>
        this.#enqueue(() => {
          const root = this.#fixtures[0]
          return root && this.#closeFixture(root)
        }),
      )
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
   * Closes the fixtures still opening and runs `closeStack`, rejecting with the failures of all of them.
   *
   * A seed that never settles holds the queue of the fixture stack, so closing is requested for every opening before `closeStack` queues its change, and the rollback does not wait for the seeds.
   */
  async #closeAfterOpenings(closeStack: () => Promise<void>): Promise<void> {
    const closings: Promise<void>[] = []
    // Each closing signals its opening synchronously, before `closeStack` queues its change behind the openings.
    for (const closeOpening of this.#openings) {
      closings.push(closeOpening())
    }
    closings.push(closeStack())
    // Every closing runs to its end, and the failures of all of them are reported.
    let rejection: Rejection | undefined
    for (const closing of await Promise.allSettled(closings)) {
      if (closing.status === "rejected") {
        rejection = suppress(closing.reason, rejection, "Closing a test fixture failed")
      }
    }
    if (rejection) {
      throw rejection.error
    }
  }

  /**
   * Runs `seed` in a savepoint of a fixture that is released when it resolves, returning its result or rejection.
   *
   * The savepoint has its own context, so late code of `seed` cannot reach the fixture after it ends.
   */
  async #seedFixture<T>(fixture: TransactionLevel, seed: () => Promise<T>): Promise<Outcome<T>> {
    try {
      return await this.#run(await this.#startNested(fixture), seed, true)
    } catch (error) {
      return { rejection: { error } }
    }
  }

  /** Closes an opened fixture as a change of the fixture stack. */
  async #closeFixture(fixture: TransactionLevel): Promise<void> {
    const index = this.#fixtures.indexOf(fixture)
    // A closed fixture is not in the stack, including one closed with an enclosing fixture.
    if (index < 0) {
      return
    }
    // Ending the fixture ends the fixtures nested in it, innermost first, and keeps all their errors.
    let rejection: Rejection | undefined
    try {
      rejection = await this.#endFixture(fixture)
    } finally {
      this.#fixtures.length = index
    }
    if (rejection) {
      throw rejection.error
    }
  }

  /** Rolls back a fixture and releases the connection of the first one, returning the error to reject with. */
  async #endFixture(fixture: TransactionLevel): Promise<Rejection | undefined> {
    const cleanup = await this.#end(fixture, false)
    return fixture.parent
      ? cleanup.rejection
      : releaseConnection(fixture.connection, cleanup.failure, cleanup.rejection)
  }

  /** Runs a change of the fixture stack after the earlier ones. */
  #enqueue<T>(transition: () => T | Promise<T>): Promise<T> {
    const result = this.#transitions.then(transition)
    this.#transitions = result.catch(() => {})
    return result
  }

  /** Starts the first test fixture: a transaction on a reserved connection. */
  async #beginFixture(): Promise<TransactionLevel> {
    const connection = await this.driver.acquire()
    try {
      await connection.execute(beginStatement)
    } catch (error) {
      const rejection = await releaseConnection(connection, { error }, { error })
      throw rejection!.error
    }
    return createLevel(connection, undefined)
  }

  /**
   * Starts a nested level of a test fixture, preempting its active one.
   *
   * A fixture runs one nested level at a time, so a new one ends the previous one, such as a test that timed out.
   */
  async #startInFixture(fixture: TransactionLevel): Promise<TransactionLevel> {
    if (fixture.child) {
      const cleanup = await this.#end(fixture.child, false, "preemption")
      // The level that preempts reports a failure to end the preempted one, even when the fixture recovered from it.
      if (cleanup.rejection) {
        throw new Error(
          "Cannot start a level of the test fixture: ending its active level failed",
          {
            cause: cleanup.rejection.error,
          },
        )
      }
    }
    const unavailable = createUnavailableError(fixture, "start a level of the test fixture")
    if (unavailable) {
      throw unavailable
    }
    return this.#startNested(fixture)
  }

  async #runRoot<T>(callback: () => Promise<T>, commits: boolean): Promise<T> {
    const connection = await this.driver.acquire()
    const level = createLevel(connection, undefined)
    let outcome: Outcome<T> | undefined
    try {
      await connection.execute(beginStatement)
    } catch (error) {
      level.state = "closed"
      outcome = { rejection: { error }, failure: { error } }
    }
    outcome ??= await this.#run(level, callback, commits)
    const rejection = await releaseConnection(connection, outcome.failure, outcome.rejection)
    if (rejection) {
      throw rejection.error
    }
    return outcome.result as T
  }

  async #runNested<T>(
    parent: TransactionLevel,
    callback: () => Promise<T>,
    commits: boolean,
  ): Promise<T> {
    const unavailable = createUnavailableError(parent, "start a nested transaction")
    if (unavailable) {
      throw unavailable
    }
    return this.#runStarted(await this.#startNested(parent), callback, commits)
  }

  /** Reserves a nested level of `parent` and sends its `SAVEPOINT`, rejecting when it fails. */
  async #startNested(parent: TransactionLevel): Promise<TransactionLevel> {
    // Reserving the level before SAVEPOINT is sent keeps statements of the parent from running inside it.
    const level = createLevel(parent.connection, parent)
    parent.child = level
    try {
      await level.connection.execute(createStatement(`SAVEPOINT ${getSavepointName(level)}`))
    } catch (error) {
      if (!level.cleanup) {
        closeStarting(level)
        throw error
      }
      // Its enclosing level ended while SAVEPOINT was running and started its cleanup.
      throw combineRejections({ error }, await level.cleanup)!.error
    }
    return level
  }

  /** Runs `callback` in a started level, returning its result or throwing its rejection. */
  async #runStarted<T>(
    level: TransactionLevel,
    callback: () => Promise<T>,
    commits: boolean,
  ): Promise<T> {
    const { result, rejection } = await this.#run(level, callback, commits)
    if (rejection) {
      throw rejection.error
    }
    return result as T
  }

  /**
   * Runs `callback` in the context of a started `level`, then ends the level.
   *
   * A level that `commits` commits only when the callback resolves with no nested level running and no nested level that failed to end.
   */
  async #run<T>(
    level: TransactionLevel,
    callback: () => Promise<T>,
    commits: boolean,
  ): Promise<Outcome<T>> {
    if (level.cleanup) {
      // Its enclosing level ended while SAVEPOINT was running.
      return {
        rejection: combineRejections(
          { error: createClosedError(level, undefined) },
          await level.cleanup,
        ),
      }
    }
    level.state = "open"
    let result: T | undefined
    let rejection: Rejection | undefined
    try {
      result = await this.#storage.run(level, callback)
    } catch (error) {
      rejection = { error }
    }
    if (level.cleanup) {
      // Its enclosing level ended first and started its cleanup.
      return {
        rejection: combineRejections(
          { error: createClosedError(level, rejection) },
          await level.cleanup,
        ),
      }
    }
    if (!rejection && level.child) {
      rejection = {
        error: new Error(
          "Transaction was rolled back: a nested transaction was still running when its callback finished",
        ),
      }
    }
    if (!rejection && level.rollbackOnly) {
      rejection = {
        error: new Error("Transaction was rolled back: a nested transaction failed to end", {
          cause: level.rollbackOnly.error,
        }),
      }
    }
    const cleanup = await this.#end(level, commits && !rejection)
    return { result, rejection: combineRejections(rejection, cleanup), failure: cleanup.failure }
  }

  /**
   * Ends `level` once, whoever ends it: later calls return the cleanup already started.
   *
   * Statements of the level and of all levels nested in it fail from the start of the cleanup, and the nested levels end before it.
   */
  #end(
    level: TransactionLevel,
    commit: boolean,
    endedBy?: TransactionLevel["endedBy"],
  ): Promise<Cleanup> {
    if (level.cleanup) {
      return level.cleanup
    }
    level.endedBy = endedBy
    // Rejecting statements before COMMIT or ROLLBACK keeps late ones from queuing after it and running outside of the level.
    level.state = "closing"
    const nested = level.child && this.#end(level.child, false, "enclosing level")
    level.cleanup = this.#cleanUp(level, commit, nested)
    return level.cleanup
  }

  async #cleanUp(
    level: TransactionLevel,
    commit: boolean,
    nested: Promise<Cleanup> | undefined,
  ): Promise<Cleanup> {
    const nestedCleanup = await nested
    const { parent } = level
    const cleanup = parent
      ? await endSavepoint(level, commit && !level.rollbackOnly)
      : await endTransaction(level.connection, commit)
    level.state = "closed"
    if (parent) {
      if (parent.child === level) {
        parent.child = undefined
      }
      // Only a failure of its own statements leaves the parent in an unknown state; a nested failure was rolled back with the level.
      parent.rollbackOnly ??= cleanup.rejection
    }
    return {
      rejection: combineRejections(nestedCleanup?.rejection, cleanup),
      failure: cleanup.failure,
    }
  }
}

const beginStatement = createStatement("BEGIN")
const commitStatement = createStatement("COMMIT")
const rollbackStatement = createStatement("ROLLBACK")

function createLevel(
  connection: Connection,
  parent: TransactionLevel | undefined,
): TransactionLevel {
  return {
    connection,
    parent,
    depth: parent ? parent.depth + 1 : 0,
    state: "starting",
    child: undefined,
    rollbackOnly: undefined,
    cleanup: undefined,
    endedBy: undefined,
  }
}

/** Name of the savepoint of a nested level; a level has at most one nested level, so the depth makes it unique. */
function getSavepointName(level: TransactionLevel): string {
  return `kern_${level.depth}`
}

/**
 * Creates the error of `operation` on a level that rejects statements and nested levels, or returns `undefined` when it accepts them.
 *
 * A level that can only roll back keeps the failure of its nested level as the cause.
 */
function createUnavailableError(level: TransactionLevel, operation: string): Error | undefined {
  if (level.state !== "open") {
    return new Error(`Cannot ${operation}: its transaction is already finished`)
  }
  // PostgreSQL would run them inside the savepoint of the nested level.
  if (level.child) {
    return new Error(`Cannot ${operation}: a nested transaction is running; await it first`)
  }
  if (level.rollbackOnly) {
    return new Error(
      `Cannot ${operation}: a nested transaction failed to end, so the transaction can only roll back`,
      { cause: level.rollbackOnly.error },
    )
  }
  return undefined
}

/** Error message of an operation outside a test transaction on a coordinator created for tests. */
function describeOutsideTest(operation: string): string {
  return `Cannot ${operation} outside a test transaction: the database was created with test: true, so wrap the test in testTransaction`
}

/** Error of `operation` started outside a transaction after closing the database was requested. */
function createDatabaseClosedError(operation: string): Error {
  return new Error(`Cannot ${operation}: the database is closed`)
}

/** Closes a nested level whose `SAVEPOINT` failed, freeing its parent for other statements. */
function closeStarting(level: TransactionLevel): void {
  level.state = "closed"
  if (level.parent?.child === level) {
    level.parent.child = undefined
  }
}

/** Error of a level that another level ended, keeping the rejection of its callback as the cause. */
function createClosedError(level: TransactionLevel, rejection: Rejection | undefined): Error {
  return new Error(
    level.endedBy === "preemption"
      ? "Transaction was rolled back: its test fixture started another level before it finished"
      : "Transaction was rolled back: its enclosing transaction ended first",
    rejection && { cause: rejection.error },
  )
}

/** Returns the connection of a transaction to the driver, keeping a failed release as a rejection that suppresses `rejection`. */
async function releaseConnection(
  connection: Connection,
  failure: TransactionFailure | undefined,
  rejection: Rejection | undefined,
): Promise<Rejection | undefined> {
  try {
    // A failed BEGIN, COMMIT, or ROLLBACK may leave the transaction open; the driver decides whether the connection can return to the pool.
    await connection.release(failure)
    return rejection
  } catch (error) {
    return suppress(error, rejection, "Releasing the transaction connection failed")
  }
}

/** Ends a transaction with `COMMIT` or `ROLLBACK`. */
async function endTransaction(connection: Connection, commit: boolean): Promise<Cleanup> {
  try {
    const { command } = await connection.execute(commit ? commitStatement : rollbackStatement)
    // PostgreSQL rolls back a transaction with a failed statement on COMMIT, even when the callback caught the error.
    if (commit && command !== "COMMIT") {
      return {
        rejection: { error: new Error("Transaction was rolled back: a statement in it failed") },
      }
    }
    return {}
  } catch (error) {
    return { rejection: { error }, failure: { error } }
  }
}

/** Ends the savepoint of a nested level, releasing it on commit and rolling back to it otherwise. */
async function endSavepoint(level: TransactionLevel, commit: boolean): Promise<Cleanup> {
  const name = getSavepointName(level)
  try {
    if (!commit) {
      await level.connection.execute(createStatement(`ROLLBACK TO SAVEPOINT ${name}`))
    }
    await level.connection.execute(createStatement(`RELEASE SAVEPOINT ${name}`))
    return {}
  } catch (error) {
    return { rejection: { error } }
  }
}

/** Rejection with the error of a cleanup, which suppresses the `earlier` rejection if there is one. */
function combineRejections(
  earlier: Rejection | undefined,
  cleanup: Cleanup,
): Rejection | undefined {
  return cleanup.rejection
    ? suppress(cleanup.rejection.error, earlier, "Transaction rollback failed")
    : earlier
}

/** Rejection with `error`, which suppresses the `earlier` rejection if there is one. */
function suppress(error: unknown, earlier: Rejection | undefined, message: string): Rejection {
  return { error: earlier ? new SuppressedError(error, earlier.error, message) : error }
}
