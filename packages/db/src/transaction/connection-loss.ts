// Failures of the connection of a transaction of `transaction`: the error that tells their phase, and the watch of the statements that records them.

import type { Connection, DriverResult, SqlStatement } from "../driver"
import { ConnectionError, isInstance, setBrand } from "../driver-error"

/** Marks an instance of `TransactionConnectionError` of any copy of kern-db. */
const transactionConnectionErrorBrand = /* @__PURE__ */ Symbol.for(
  "kern-db.TransactionConnectionError",
)

/** Phase of a transaction in which its connection failed. */
type TransactionPhase = TransactionConnectionError["phase"]

/** Message of a transaction whose connection failed in each phase. */
const phaseMessages: Record<TransactionPhase, string> = {
  begin: "Transaction did not start: its connection failed",
  transaction: "Transaction was rolled back: its connection failed",
  commit: "Transaction may have been committed: its connection failed during COMMIT",
}

/**
 * Error of a transaction whose connection failed, which tells whether the transaction may have been committed.
 *
 * Its `cause` is the error that the transaction would reject with otherwise, such as the error of the callback, or a `SuppressedError` of a failed rollback that keeps it.
 */
export class TransactionConnectionError extends ConnectionError {
  override readonly name: string = "TransactionConnectionError"
  /**
   * Phase of the transaction in which its connection failed:
   *
   * - `begin`: before the callback, such as getting the connection or `BEGIN`, so the transaction applied nothing;
   * - `transaction`: in the callback or its rollback, so the transaction was rolled back;
   * - `commit`: during `COMMIT`, so whether the transaction was committed is unknown.
   */
  readonly phase: "begin" | "transaction" | "commit"

  constructor(phase: TransactionPhase, options?: { cause?: unknown }) {
    super(phaseMessages[phase], options)
    this.phase = phase
    setBrand(this, transactionConnectionErrorBrand)
  }

  /** Tells whether `value` is an instance of the class, including one of `TransactionConnectionError` of another copy of kern-db. */
  static override [Symbol.hasInstance]<T>(
    this: abstract new (...args: never) => T,
    value: unknown,
  ): value is T {
    return isInstance(this, TransactionConnectionError, transactionConnectionErrorBrand, value)
  }
}

/** First `ConnectionError` on the connection of a transaction, with the phase of the transaction when it came. */
interface ConnectionFailure {
  readonly error: unknown
  readonly phase: TransactionPhase
}

/**
 * Reserved connection of a transaction of `transaction` that records the first `ConnectionError` of its statements and scripts, including those of its nested levels.
 *
 * A failure before `COMMIT` is sent makes the transaction roll back rather than commit, since the statement may not have run.
 * A transaction that rejects after a failure rejects with `TransactionConnectionError` of its phase, while one whose `COMMIT` succeeded resolves.
 */
export class ConnectionWatch implements Connection {
  /** Phase of the transaction, which its root advances to `transaction` before the callback and to `commit` before `COMMIT`. */
  phase: TransactionPhase = "begin"
  /** First `ConnectionError`; a later statement that succeeds changes nothing. */
  failure: ConnectionFailure | undefined
  readonly #connection: Connection
  // One handler for every statement of the transaction keeps a statement from allocating more than the promise that observes it.
  readonly #observe = (error: unknown): never => {
    // The phase is the one when the rejection comes rather than when the statement was sent: a client that pipelines may have sent a later COMMIT before the connection failed, and then rejects every statement it queued.
    if (!this.failure && error instanceof ConnectionError) {
      this.failure = { error, phase: this.phase }
    }
    throw error
  }

  constructor(connection: Connection) {
    this.#connection = connection
  }

  execute(statement: SqlStatement): Promise<DriverResult> {
    return this.#connection.execute(statement).catch(this.#observe)
  }

  executeScript(text: string): Promise<void> {
    return this.#connection.executeScript(text).catch(this.#observe)
  }

  release(): void | Promise<void> {
    return this.#connection.release()
  }
}
