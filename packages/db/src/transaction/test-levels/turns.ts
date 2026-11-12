// Turns of the callbacks that share the connection of an open test transaction: a statement outside a transaction or a nested level holds the connection until it ends.

/**
 * Queue of the units of work that share the connection of an open test transaction, which run one at a time in the order they ask for a turn.
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
