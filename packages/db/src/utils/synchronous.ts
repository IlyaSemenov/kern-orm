// The rule that a callback which decoding calls, such as `decodeNull` of a type or a conversion of a query builder, returns its result synchronously.
// Decoding is synchronous, so nothing would wait for a Promise in a value of a row.

import { types } from "node:util"

/** Type that the result of a callback that decoding calls is checked against when it has a method `then`, such as a Promise. */
export interface NotSynchronous {
  readonly "the callback must return its result synchronously": never
}

/**
 * Check of `R`, the result of a callback that decoding calls: it fails against `NotSynchronous` when a member of the union `R` has a method `then`, such as a Promise.
 *
 * It takes `any` and `unknown`, and a `then` whose type may also be `undefined`, which `rejectThenable` checks at runtime.
 */
// A method of any parameters, as `rejectThenable` rejects any callable `then`, also of a thenable that is not a `PromiseLike` of its full signature.
export type SynchronousResult<R> = [Extract<R, { then(...args: never[]): unknown }>] extends [never]
  ? unknown
  : 0 extends 1 & R
    ? unknown
    : NotSynchronous

/**
 * Throws `TypeError` of `message` when `result`, of a callback that decoding calls, is a thenable, such as a Promise or a query, which a callback may still return through `any`.
 *
 * It does not call `then` of the thenable, which would execute a query.
 */
export function rejectThenable(result: unknown, message: string): void {
  try {
    if (typeof (result as { then?: unknown } | null | undefined)?.then !== "function") {
      return
    }
  } catch (error) {
    // A getter `then` may throw, also of a subclass of Promise, which is a thenable all the same; the error of another value is its own.
    if (!types.isPromise(result)) {
      throw error
    }
  }
  // Decoding fails here, so a rejection of the Promise would reach no code, and end the process as an unhandled rejection.
  // Only a Promise, of any realm: calling `then` of another value, such as a query, could execute it.
  // The built-in `then`, since a subclass of Promise may override `then` and `catch`.
  if (types.isPromise(result)) {
    Promise.prototype.then.call(result, undefined, ignoreRejection)
  }
  throw new TypeError(message)
}

/** Handles the rejection of a Promise that a callback returned, whose decoding has failed already. */
function ignoreRejection(): void {}
