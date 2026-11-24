import { describe, expect, it } from "bun:test"
import { runInNewContext } from "node:vm"

import { getThrownError } from "@kern-orm/test-harness/errors"

import { rejectThenable } from "./synchronous"

describe("rejectThenable", () => {
  const message = "The callback must return its result synchronously"

  it("takes a result that is not a thenable", () => {
    for (const result of [undefined, null, 0, "a", {}, { then: 1 }, () => 1]) {
      expect(() => rejectThenable(result, message)).not.toThrow()
    }
  })

  it("rejects a Promise and another thenable without calling its then", () => {
    let calls = 0
    const thenable = {
      // oxlint-disable-next-line unicorn/no-thenable -- the thenable is what the test passes
      then: () => {
        calls++
      },
    }

    expect(getThrownError(() => rejectThenable(Promise.resolve(1), message))).toEqual(
      new TypeError(message),
    )
    expect(getThrownError(() => rejectThenable(thenable, message))).toEqual(new TypeError(message))
    expect(calls).toBe(0)
  })

  it("throws the error of a getter then of a value other than a Promise", () => {
    const failure = new Error("getter of then")
    const value = {
      // oxlint-disable-next-line unicorn/no-thenable -- the getter is what the test checks
      get then(): never {
        throw failure
      },
    }

    expect(getThrownError(() => rejectThenable(value, message))).toBe(failure)
  })

  it("handles the rejection of a Promise that it rejects, so that it stays out of unhandled rejections", async () => {
    /** Subclass of Promise whose `then` and `catch` throw, so that only the built-in `then` handles its rejection. */
    class ThrowingThen<T> extends Promise<T> {
      // oxlint-disable-next-line unicorn/no-thenable -- the overridden then is what the test checks
      override then(): never {
        throw new Error("then of a subclass")
      }
      override catch(): never {
        throw new Error("catch of a subclass")
      }
    }
    const withThrowingGetter = Promise.reject(new Error("Rejected"))
    Object.defineProperty(withThrowingGetter, "then", {
      get: () => {
        throw new Error("getter of then")
      },
    })
    const unhandled: unknown[] = []
    const onUnhandled = (reason: unknown) => unhandled.push(reason)
    process.on("unhandledRejection", onUnhandled)
    try {
      for (const result of [
        Promise.reject(new Error("Rejected")),
        new Promise((_, reject) => {
          setTimeout(() => reject(new Error("Rejected later")))
        }),
        runInNewContext("Promise.reject(new Error('Rejected'))"),
        new ThrowingThen((_, reject) => reject(new Error("Rejected"))),
        withThrowingGetter,
      ]) {
        expect(getThrownError(() => rejectThenable(result, message))).toEqual(
          new TypeError(message),
        )
      }
      // Longer than the timer of the Promise, and than the turn in which a runtime reports an unhandled rejection.
      await new Promise(resolve => setTimeout(resolve, 10))

      expect(unhandled).toEqual([])
    } finally {
      process.off("unhandledRejection", onUnhandled)
    }
  })
})
