// Open test transactions of a database created for tests: test levels that the callbacks of `run`, such as the requests of one browser test to a server, share until they close.

import type { AsyncLocalStorage } from "node:async_hooks"

import type { IsolationLevel } from "../../database"
import type { Driver } from "../../driver"
import type { OpenedTestTransaction, OpenTestTransactionOptions } from "../../test-helpers"
import type { Rejection, TransactionLevel } from "../level"
import {
  closeStarting,
  createLevel,
  endLevel,
  getBeginStatement,
  getEndedOutcome,
  suppress,
} from "../level"
import type { ReleaseErrorHandler } from "../release"
import { releaseConnection } from "../release"

import type { TestFixtureStack } from "./fixture-stack"
import { TurnQueue } from "./turns"

/** Opens the test transactions of a transaction coordinator, and closes those on connections of their own when the database closes. */
export class OpenTestTransactions {
  readonly #driver: Driver
  readonly #storage: AsyncLocalStorage<TransactionLevel>
  readonly #fixtures: TestFixtureStack
  readonly #onReleaseError: ReleaseErrorHandler | undefined
  /** The `close` functions of the open test transactions on connections of their own; those in a fixture close with it. */
  readonly #roots = new Set<() => Promise<void>>()

  constructor(
    driver: Driver,
    storage: AsyncLocalStorage<TransactionLevel>,
    fixtures: TestFixtureStack,
    onReleaseError: ReleaseErrorHandler | undefined,
  ) {
    this.#driver = driver
    this.#storage = storage
    this.#fixtures = fixtures
    this.#onReleaseError = onReleaseError
  }

  /**
   * Opens a test transaction: a savepoint in the innermost open fixture, which preempts its active level, or a transaction on a connection of its own.
   *
   * Its statements outside a transaction and its nested levels take turns on its connection, see `runInTurn`.
   * `getClosedError` returns the error of an opening once closing the database is requested; an opening on a connection of its own that the closing overtakes rolls back and rejects with it, since the closing no longer sees it.
   */
  async open(
    options: OpenTestTransactionOptions | undefined,
    getClosedError: () => Error | undefined,
  ): Promise<OpenedTestTransaction> {
    const nested = await this.#fixtures.startTestLevel(options)
    const level = nested ?? (await this.#begin(options?.isolation, getClosedError))
    if (nested?.cleanup) {
      // The fixture closed, or another level preempted this one, before it opened.
      const { rejection } = await getEndedOutcome(
        nested.cleanup,
        new Error("Cannot open a test transaction: its test fixture ended it before it opened"),
      )
      throw rejection!.error
    }
    level.state = "open"
    level.turns = new TurnQueue()
    let closing: Promise<void> | undefined
    const close = () => {
      closing ??= (async () => {
        const { rejection } = await endLevel(level, false)
        if (!nested) {
          this.#roots.delete(close)
          await releaseConnection(level.connection, this.#onReleaseError)
        }
        if (rejection) {
          throw rejection.error
        }
      })()
      return closing
    }
    if (!nested) {
      const closedError = getClosedError()
      if (closedError) {
        let rejection: Rejection = { error: closedError }
        try {
          await close()
        } catch (error) {
          rejection = suppress(error, rejection, "Transaction rollback failed")
        }
        throw rejection.error
      }
      this.#roots.add(close)
    }
    return {
      run: async callback => {
        // Late code of a closed test transaction must not run its side effects, also in its own context.
        if (level.state !== "open") {
          throw new Error("Cannot run a callback in the test transaction: it is already closed")
        }
        const current = this.#storage.getStore()
        if (current === level) {
          return callback()
        }
        // A callback inside a transaction of this test transaction would wait for its own turn.
        if (current) {
          throw new Error("Cannot run a callback in an open test transaction inside a transaction")
        }
        return this.#storage.run(level, callback)
      },
      get isOpen() {
        return level.state === "open"
      },
      close,
      [Symbol.asyncDispose]: close,
    }
  }

  /** Rolls back the open test transactions on connections of their own, rejecting with the failures of all of them. */
  async close(): Promise<void> {
    const closings: Promise<void>[] = []
    for (const close of this.#roots) {
      closings.push(close())
    }
    let rejection: Rejection | undefined
    for (const closing of await Promise.allSettled(closings)) {
      if (closing.status === "rejected") {
        rejection = suppress(closing.reason, rejection, "Closing a test transaction failed")
      }
    }
    if (rejection) {
      throw rejection.error
    }
  }

  /**
   * Begins an open test transaction outside a fixture at `isolation` on a connection of its own.
   *
   * Once closing the database is requested, it releases the connection instead of sending `BEGIN`, and rejects with the error of `getClosedError`.
   */
  async #begin(
    isolation: IsolationLevel | undefined,
    getClosedError: () => Error | undefined,
  ): Promise<TransactionLevel> {
    // Closing the database may have closed the fixtures while the opening waited for its turn in their queue.
    const closedError = getClosedError()
    if (closedError) {
      throw closedError
    }
    const connection = await this.#driver.acquire()
    const lateError = getClosedError()
    if (lateError) {
      await releaseConnection(connection, this.#onReleaseError)
      throw lateError
    }
    const level = createLevel(connection, undefined, false, isolation)
    try {
      await connection.execute(getBeginStatement(isolation))
    } catch (error) {
      closeStarting(level)
      await releaseConnection(connection, this.#onReleaseError)
      throw error
    }
    return level
  }
}
