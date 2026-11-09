// Errors that a driver rejects with, which tell a statement that PostgreSQL rejected from a failure that leaves the state of its connection unknown.

/** Marks an instance of `QueryError` of any copy of kern-orm, which `instanceof QueryError` of another copy recognizes. */
const queryErrorBrand = /* @__PURE__ */ Symbol.for("kern-orm.QueryError")
/** Marks an instance of `ConnectionError` of any copy of kern-orm. */
const connectionErrorBrand = /* @__PURE__ */ Symbol.for("kern-orm.ConnectionError")

/**
 * Tells whether `value` is an instance of `errorClass`: by the brand of any copy of kern-orm for `errorClass` itself, and by the prototype chain for its subclasses.
 *
 * An application can load several copies of kern-orm, such as one of a driver, and an error of one copy is then an instance of the class of another.
 */
export function isInstance(errorClass: unknown, root: unknown, brand: symbol, value: unknown) {
  if (errorClass !== root) {
    return Function.prototype[Symbol.hasInstance].call(errorClass, value)
  }
  return (
    typeof value === "object" &&
    value !== null &&
    (value as Record<symbol, unknown>)[brand] === true
  )
}

/** Sets the brand of `error`, which is not enumerable, so that it does not show among the fields of the error. */
export function setBrand(error: Error, brand: symbol): void {
  Object.defineProperty(error, brand, { value: true })
}

/**
 * Error of a statement that PostgreSQL rejected, such as for a violated constraint; the connection of the statement stays usable.
 *
 * A driver whose client gives the severity of an error only in the language of the server, such as node-postgres, tells such an error by its SQLSTATE when the server translates its messages.
 * An error that ends the session with a code that a statement also gets, such as `40001` of a conflict with recovery on a replica, then rejects with `QueryError`, and the next statement on the connection with `ConnectionError`.
 */
export class QueryError extends Error {
  override readonly name = "QueryError"
  /** SQLSTATE of the error, such as `23505` for a violated unique constraint. */
  readonly code: string
  /** Name of the constraint that the statement violated, if any. */
  readonly constraint: string | undefined

  constructor(
    message: string,
    fields: { code: string; constraint?: string | undefined; cause?: unknown },
  ) {
    // As `Error` does, an error gets `cause` only when the fields have it.
    super(message, "cause" in fields ? { cause: fields.cause } : undefined)
    this.code = fields.code
    this.constraint = fields.constraint
    setBrand(this, queryErrorBrand)
  }

  /** Tells whether `value` is an instance of the class, including one of `QueryError` of another copy of kern-orm. */
  static override [Symbol.hasInstance]<T>(
    this: abstract new (...args: never) => T,
    value: unknown,
  ): value is T {
    return isInstance(this, QueryError, queryErrorBrand, value)
  }
}

/**
 * Error of a statement or connection that failed for another reason than PostgreSQL rejecting a statement, such as a lost connection, a timeout of the client, or a closed driver.
 *
 * The statement may have run or not, and its connection may be lost or in an unknown state of its transaction.
 */
export class ConnectionError extends Error {
  // A string rather than its literal, so that a subclass, such as `TransactionConnectionError`, names itself.
  override readonly name: string = "ConnectionError"

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    setBrand(this, connectionErrorBrand)
  }

  /** Tells whether `value` is an instance of the class, including one of `ConnectionError` of another copy of kern-orm. */
  static override [Symbol.hasInstance]<T>(
    this: abstract new (...args: never) => T,
    value: unknown,
  ): value is T {
    return isInstance(this, ConnectionError, connectionErrorBrand, value)
  }
}

/** Fields of the PostgreSQL error that an error of a client carries, by which `toDriverError` classifies it. */
export interface DriverErrorFields {
  /**
   * Severity of the error, such as `ERROR` or `FATAL`.
   *
   * Pass the severity in English when the client gives it, and the one in the language of the server otherwise.
   */
  readonly severity?: unknown
  /** SQLSTATE of the error, such as `23505`. */
  readonly code?: unknown
  /** Name of the constraint that the statement violated. */
  readonly constraint?: unknown
}

/** SQLSTATE of five digits or uppercase letters; clients also give codes of their own, such as `ECONNRESET` or `CONNECTION_CLOSED`. */
const sqlState = /^[0-9A-Z]{5}$/

/** SQLSTATE of an error that ends the session: of the classes of connection exceptions, authorization, operator intervention, and internal errors, and the timeouts of an idle transaction and of a transaction. */
const sessionEndingCode = /^(?:08|28|57P|XX|25P03$|25P04$)/

/** Tells whether an error of the server of `severity` and SQLSTATE `code` ends its session. */
function isSessionEnding(severity: string, code: string): boolean {
  if (severity === "ERROR") {
    return false
  }
  if (severity === "FATAL" || severity === "PANIC") {
    return true
  }
  // A translated severity: the SQLSTATE tells an error that ends the session.
  return sessionEndingCode.test(code)
}

/**
 * Classifies an error of a client as `QueryError` or `ConnectionError`, by the fields of the PostgreSQL error it carries, for a driver to reject with.
 *
 * An error that kern-orm has already classified returns as it is.
 * An error without a severity or a SQLSTATE, such as of a client that lost its connection, is a `ConnectionError`, and so is one of severity `FATAL` or `PANIC`, which ends the session.
 * An error of severity `ERROR` is a `QueryError`.
 * With a translated severity, the SQLSTATE tells an error that ends the session, so a few errors of other codes that end it give `QueryError`.
 */
export function toDriverError(
  error: unknown,
  fields?: DriverErrorFields,
): QueryError | ConnectionError {
  if (error instanceof QueryError || error instanceof ConnectionError) {
    return error
  }
  const message = error instanceof Error ? error.message : String(error)
  const { severity, code, constraint } = fields ?? {}
  // Every error of the server has a severity, which errors of the client lack, though some of them have a code of five characters, such as `EPIPE`.
  if (typeof severity !== "string" || typeof code !== "string" || !sqlState.test(code)) {
    return new ConnectionError(message, { cause: error })
  }
  if (isSessionEnding(severity, code)) {
    return new ConnectionError(message, { cause: error })
  }
  return new QueryError(message, {
    code,
    constraint: typeof constraint === "string" ? constraint : undefined,
    cause: error,
  })
}
