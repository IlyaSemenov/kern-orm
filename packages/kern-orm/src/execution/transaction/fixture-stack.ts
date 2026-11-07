// Stack of the test fixtures of a database created for tests: outer levels in which test transactions and later fixtures nest, changed through one queue.

import type { AsyncLocalStorage } from "node:async_hooks"

import type { Driver } from "../driver"
import type { OpenedTestFixture, PendingTestFixture } from "../testing"

import { settleUnlessAborted } from "./abort"
import type { Outcome, Rejection, TransactionLevel } from "./level"
import {
  beginStatement,
  combineRejections,
  createLevel,
  createUnavailableError,
  endLevel,
  releaseConnection,
  runLevel,
  startNestedLevel,
  suppress,
  suppressAbortReason,
} from "./level"

/** Open test fixtures of a transaction coordinator and the queue of the changes of their stack. */
export class TestFixtureStack {
  readonly #driver: Driver
  /** Async context of the levels of the coordinator, which tells whether a call runs inside a level. */
  readonly #storage: AsyncLocalStorage<TransactionLevel>
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

  constructor(driver: Driver, storage: AsyncLocalStorage<TransactionLevel>) {
    this.#driver = driver
    this.#storage = storage
  }

  /**
   * Starts opening a test fixture, see `startTestFixture` of the coordinator, or, given `refusal`, returns a fixture that rejects with it.
   *
   * The `close` of a refused fixture resolves once the earlier changes of the stack end.
   */
  start<T>(seed: () => Promise<T>, refusal: Error | undefined): PendingTestFixture<T> {
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
    if (refusal) {
      return { fixture: Promise.reject(refusal), close }
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
   * Starts the level of a test transaction in the innermost test fixture as a change of the fixture stack, resolving to `undefined` when no fixture is open.
   *
   * Aborted while it waits for its turn, it rejects at once and its change starts nothing, so that a test that has already ended never preempts the active level of the fixture.
   * From its turn on, it settles with its change.
   */
  startTestLevel(signal: AbortSignal | undefined): Promise<TransactionLevel | undefined> {
    let waiting = true
    const start = () =>
      this.#enqueue(() => {
        if (signal?.aborted) {
          return undefined
        }
        waiting = false
        const fixture = this.#fixtures.at(-1)
        return fixture && this.#startInFixture(fixture, signal)
      })
    return signal ? settleUnlessAborted(start, signal, () => waiting) : start()
  }

  /**
   * Closes every fixture, including those still opening, rejecting with the failures of all of them.
   *
   * Unlike closing a fixture, it closes every opening, including one started after a closing of the stack was requested, since nothing may stay open.
   */
  close(): Promise<void> {
    // Closing the first fixture closes the whole stack.
    return this.#closeAfterOpenings(() =>
      this.#enqueue(() => {
        const root = this.#fixtures[0]
        return root && this.#closeFixture(root)
      }),
    )
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
      return await runLevel(this.#storage, await startNestedLevel(fixture, false), seed, true)
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
    const cleanup = await endLevel(fixture, false)
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
    const connection = await this.#driver.acquire()
    try {
      await connection.execute(beginStatement)
    } catch (error) {
      const rejection = await releaseConnection(connection, { error }, { error })
      throw rejection!.error
    }
    return createLevel(connection, undefined, false)
  }

  /**
   * Starts a nested level of a test fixture, preempting its active one.
   *
   * A fixture runs one nested level at a time, so a new one ends the previous one, such as a test that timed out.
   * A level whose `signal` aborts while it preempts rejects with its reason instead of starting, and a failure to start after the abort suppresses the reason.
   */
  async #startInFixture(
    fixture: TransactionLevel,
    signal?: AbortSignal,
  ): Promise<TransactionLevel> {
    if (fixture.child) {
      const cleanup = await endLevel(fixture.child, false, "preemption")
      // The level that preempts reports a failure to end the preempted one, even when the fixture recovered from it.
      if (cleanup.rejection) {
        throw suppressAbortReason(
          new Error("Cannot start a level of the test fixture: ending its active level failed", {
            cause: cleanup.rejection.error,
          }),
          signal,
        )
      }
    }
    const unavailable = createUnavailableError(fixture, "start a level of the test fixture")
    if (unavailable) {
      throw suppressAbortReason(unavailable, signal)
    }
    signal?.throwIfAborted()
    return startNestedLevel(fixture, false, signal)
  }
}
