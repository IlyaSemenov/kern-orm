// Errors that the tests check by `toEqual`, which compares the class and the fields of an error, unlike `toThrow(new X(message))` of Bun, which compares only the message.

/** Returns the error that `callback` throws, and throws when it returns. */
export function getThrownError(callback: () => unknown): unknown {
  try {
    callback()
  } catch (error) {
    return error
  }
  throw new Error("Expected the callback to throw")
}

/** Returns the error that `promise` rejects with, and rejects when it resolves. */
export function getRejection(promise: PromiseLike<unknown>): Promise<unknown> {
  return Promise.resolve(promise).then(
    () => {
      throw new Error("Expected the promise to reject")
    },
    (error: unknown) => error,
  )
}
