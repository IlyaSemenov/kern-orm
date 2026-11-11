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
