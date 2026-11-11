import { createRecordingDriver } from "@kern-orm/test-harness/recording-driver"

import type { SqlStatement } from "../driver"
import { createStatement } from "../driver"

import { TransactionCoordinator } from "./coordinator"
import type { ReleaseErrorHandler } from "./release"

/** Marks the rejection of `promise` as handled, so that a test can inspect it after it settles. */
export function markHandled<T>(promise: Promise<T>): Promise<T> {
  promise.catch(() => {})
  return promise
}

/** Waits until pending promise callbacks run, such as the end of a transaction whose callback has settled. */
export function settleCallbacks(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve))
}

/** Response that fails `text`, or only its `occurrence` when given, with `error` and answers other statements. */
export function failOn(text: string, error: unknown, occurrence?: number) {
  let seen = 0
  return (statement: SqlStatement) => {
    if (statement.text === text && (occurrence === undefined || ++seen === occurrence)) {
      throw error
    }
    return {}
  }
}

/**
 * Response that holds the statement `text`, or its later `occurrence`, until `resume` is called and reports when it is reached.
 *
 * With `error`, the held statement fails with it once resumed.
 */
export function holdOn(text: string, occurrence = 1, error?: unknown) {
  const reached = Promise.withResolvers<void>()
  const resumed = Promise.withResolvers<void>()
  let seen = 0
  return {
    async respond(statement: SqlStatement) {
      if (statement.text === text && ++seen === occurrence) {
        reached.resolve()
        await resumed.promise
        if (error) {
          throw error
        }
      }
      return {}
    },
    reached: reached.promise,
    resume: () => resumed.resolve(),
  }
}

/** Coordinator created for tests over a recording driver, which passes a failed release of a connection to `onReleaseError`. */
export function createTestCoordinator(
  options?: Parameters<typeof createRecordingDriver>[0],
  onReleaseError?: ReleaseErrorHandler,
) {
  const recording = createRecordingDriver(options)
  return {
    ...recording,
    coordinator: new TransactionCoordinator(recording.driver, { test: true, onReleaseError }),
  }
}

/** Callback that executes the statement `text`. */
export function run(coordinator: TransactionCoordinator, text: string) {
  return () => coordinator.execute(createStatement(text)).then(() => undefined)
}

/** Seed of a test fixture that changes nothing. */
export const seedNothing = () => Promise.resolve()
