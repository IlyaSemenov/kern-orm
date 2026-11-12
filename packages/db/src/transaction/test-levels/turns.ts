// Turns on the connection of a level of the test helpers, which emulates the pool for the code under test: a statement outside a transaction or a nested level holds the connection until it ends.

import type { Connection } from "../../driver"
import { createStatement } from "../../driver"
import type { TransactionLevel } from "../level"
import {
  closeStarting,
  combineRejections,
  createLevel,
  createUnavailableError,
  endLevel,
  getSavepointName,
} from "../level"

/**
 * Queue of the units of work that share the connection of a level of the test helpers, which run one at a time in the order they ask for a turn.
 *
 * The holder of the turn passes it to the next waiter with `release`.
 * Once closed, it grants every turn at once, so that its waiters see that the level is closed and reject.
 */
export class TurnQueue {
  #held = false
  #closed = false
  /** Waiters in the order they asked for a turn; each one, called, takes the turn. */
  readonly #waiters: (() => void)[] = []

  /**
   * Resolves once the caller holds the turn, or at once after `close`.
   *
   * Aborted by `signal` while it waits, it leaves the queue and rejects with the reason of the signal; given an aborted signal, it rejects without taking the turn.
   */
  take(signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) {
      return Promise.reject(signal.reason)
    }
    if (this.#closed) {
      return Promise.resolve()
    }
    if (!this.#held) {
      this.#held = true
      return Promise.resolve()
    }
    const { promise, resolve, reject } = Promise.withResolvers<void>()
    const onAbort = () => {
      this.#waiters.splice(this.#waiters.indexOf(grant), 1)
      reject(signal!.reason)
    }
    // A granted waiter stops listening, so an abort after its turn comes does not leave it holding the turn without knowing it.
    const grant = () => {
      signal?.removeEventListener("abort", onAbort)
      resolve()
    }
    signal?.addEventListener("abort", onAbort, { once: true })
    this.#waiters.push(grant)
    return promise
  }

  /** Takes the turn at once when it is free or the queue is closed, and tells whether it did. */
  tryTake(): boolean {
    if (this.#closed) {
      return true
    }
    if (this.#held) {
      return false
    }
    this.#held = true
    return true
  }

  /** Passes the turn of the caller to the next waiter, or frees it. */
  release(): void {
    if (this.#closed) {
      return
    }
    const next = this.#waiters.shift()
    if (next) {
      next()
    } else {
      this.#held = false
    }
  }

  /** Grants the turn to every waiter and to every later caller. */
  close(): void {
    this.#closed = true
    for (const grant of this.#waiters.splice(0)) {
      grant()
    }
  }
}

/**
 * Runs `start` on its turn on the connection of a level of the test helpers `level`, and passes the turn on once it settles, after the level it started has ended.
 *
 * The code of the level runs statements and transactions at once on its connection, such as the requests of an open test transaction, where PostgreSQL would run a statement inside a nested transaction of other code, so they take turns rather than reject as in a transaction of `transaction`.
 * It rejects without calling `start` when the level accepts no statements on its turn, and with the reason of `signal` when it aborts first.
 */
export async function runInTurn<T>(
  level: TransactionLevel,
  operation: string,
  start: () => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  const turns = level.turns!
  // Taking a free turn without awaiting runs `start` in the call, so that a statement goes to the connection when the code calls it, as on a connection of its own.
  if (!turns.tryTake()) {
    await turns.take(signal)
  }
  try {
    signal?.throwIfAborted()
    const unavailable = createUnavailableError(level, operation)
    if (unavailable) {
      throw unavailable
    }
    return await start()
  } finally {
    turns.release()
  }
}

/**
 * Runs a statement of `run` on its turn in a savepoint of its own in a level of the test helpers `level`, released when it succeeds and rolled back when it fails.
 *
 * A statement outside a transaction commits or fails alone in production, so its failure must not abort the transaction of the test.
 * A statement sent before the level ends settles with its own result, as on the connection of a transaction: the rollback of the level undoes it, and reports the failures of that rollback.
 */
export function runStatementInTurn<T>(
  level: TransactionLevel,
  operation: string,
  run: (connection: Connection) => Promise<T>,
): Promise<T> {
  return runInTurn(level, operation, async () => {
    const unit = createLevel(level.connection, level, false)
    level.child = unit
    const { connection } = unit
    // The statement goes right behind its SAVEPOINT rather than after it completes, so that a statement that the code has called runs before a rollback of the level; when PostgreSQL rejects SAVEPOINT, it also rejects the following statement in the failed transaction.
    const savepoint = connection.execute(createStatement(`SAVEPOINT ${getSavepointName(unit)}`))
    unit.state = "open"
    const running = run(connection)
    try {
      await savepoint
    } catch (error) {
      await running.catch(() => {})
      if (unit.cleanup) {
        // Its level ended while SAVEPOINT ran and started its cleanup.
        throw combineRejections({ error }, await unit.cleanup)!.error
      }
      // A client may refuse SAVEPOINT without sending it and still send the statement, which then ran in the level itself, so the level can only roll back.
      level.rollbackOnly ??= { error }
      closeStarting(unit)
      throw error
    }
    let result: T
    try {
      result = await running
    } catch (error) {
      const cleanup = await endLevel(unit, false)
      throw unit.endedBy ? error : combineRejections({ error }, cleanup)!.error
    }
    const cleanup = await endLevel(unit, true)
    if (cleanup.rejection && !unit.endedBy) {
      throw cleanup.rejection.error
    }
    return result
  })
}
