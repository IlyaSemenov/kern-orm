import { describe, expect, it } from "bun:test"

import { ConnectionError, QueryError, toDriverError } from "./driver-error"

describe("QueryError and ConnectionError", () => {
  it("name themselves and keep their fields and cause", () => {
    const cause = new Error("duplicate key")
    const queryError = new QueryError("duplicate key", {
      code: "23505",
      constraint: "form_pkey",
      cause,
    })
    const connectionError = new ConnectionError("Connection terminated", { cause })

    expect(queryError).toMatchObject({
      name: "QueryError",
      message: "duplicate key",
      code: "23505",
      constraint: "form_pkey",
      cause,
    })
    expect(connectionError).toMatchObject({ name: "ConnectionError", cause })
  })

  it("have no cause unless it is given", () => {
    expect("cause" in new QueryError("rejected", { code: "22012" })).toBe(false)
    expect("cause" in new ConnectionError("lost")).toBe(false)
  })

  it("keep their brands out of the enumerable fields", () => {
    expect(Object.keys(new QueryError("rejected", { code: "22012" }))).toEqual([
      "name",
      "code",
      "constraint",
    ])
    expect(Object.keys(new ConnectionError("lost"))).toEqual(["name"])
  })

  it("recognize an error of another copy of kern-orm by its brand", () => {
    const queryError = Object.assign(new Error("rejected"), {
      [Symbol.for("kern-orm.QueryError")]: true,
    })
    const connectionError = Object.assign(new Error("lost"), {
      [Symbol.for("kern-orm.ConnectionError")]: true,
    })

    expect(queryError instanceof QueryError).toBe(true)
    expect(queryError instanceof ConnectionError).toBe(false)
    expect(connectionError instanceof ConnectionError).toBe(true)
    expect(connectionError instanceof QueryError).toBe(false)
  })

  it("recognize an instance of a subclass by its prototype", () => {
    class UniqueViolation extends QueryError {}
    const subclassed = new UniqueViolation("duplicate key", { code: "23505" })

    expect(subclassed instanceof UniqueViolation).toBe(true)
    expect(subclassed instanceof QueryError).toBe(true)
    expect(new QueryError("duplicate key", { code: "23505" }) instanceof UniqueViolation).toBe(
      false,
    )
  })

  it("recognize no other value", () => {
    for (const value of [new Error("rejected"), "QueryError", null, undefined, {}]) {
      expect(value instanceof QueryError).toBe(false)
      expect(value instanceof ConnectionError).toBe(false)
    }
  })
})

describe("toDriverError", () => {
  /** Error of a client with the fields of a PostgreSQL error. */
  const serverError = new Error("server")

  it("gives QueryError with the code and constraint of an error of severity ERROR", () => {
    const error = toDriverError(serverError, {
      severity: "ERROR",
      code: "23505",
      constraint: "form_pkey",
    })

    expect(error).toBeInstanceOf(QueryError)
    expect(error).toMatchObject({
      message: "server",
      code: "23505",
      constraint: "form_pkey",
      cause: serverError,
    })
  })

  it("gives no constraint of a value of another type", () => {
    const error = toDriverError(serverError, { severity: "ERROR", code: "23505", constraint: 1 })

    expect(error).toMatchObject({ constraint: undefined })
  })

  it.each(["FATAL", "PANIC"])("gives ConnectionError of an error of severity %s", severity => {
    const error = toDriverError(serverError, { severity, code: "57P01" })

    expect(error).toBeInstanceOf(ConnectionError)
    expect(error).toMatchObject({ message: "server", cause: serverError })
  })

  it("classifies a code of either kind by the severity in English", () => {
    expect(toDriverError(serverError, { severity: "ERROR", code: "40001" })).toBeInstanceOf(
      QueryError,
    )
    expect(toDriverError(serverError, { severity: "FATAL", code: "40001" })).toBeInstanceOf(
      ConnectionError,
    )
  })

  it.each([
    ["23505", QueryError],
    ["40001", QueryError],
    ["57P01", ConnectionError],
    ["08006", ConnectionError],
    ["28P01", ConnectionError],
    ["XX000", ConnectionError],
    ["25P03", ConnectionError],
    ["25P04", ConnectionError],
  ])("classifies code %s of a translated severity by the code", (code, errorClass) => {
    expect(toDriverError(serverError, { severity: "ОШИБКА", code })).toBeInstanceOf(errorClass)
  })

  it("gives ConnectionError of an error without a severity, also with a code of five characters", () => {
    for (const code of ["EPIPE", "CONNECTION_CLOSED", "23505"]) {
      expect(toDriverError(Object.assign(new Error("client"), { code }), { code })).toBeInstanceOf(
        ConnectionError,
      )
    }
  })

  it("gives ConnectionError of an error with a severity but without a SQLSTATE", () => {
    for (const code of [undefined, "2350", "235050", "2350a", 23505]) {
      expect(toDriverError(serverError, { severity: "ERROR", code })).toBeInstanceOf(
        ConnectionError,
      )
    }
  })

  it("gives ConnectionError of an error without fields", () => {
    expect(toDriverError(serverError)).toBeInstanceOf(ConnectionError)
  })

  it("takes the message of a thrown value that is not an Error from its text", () => {
    const error = toDriverError("socket closed")

    expect(error).toBeInstanceOf(ConnectionError)
    expect(error).toMatchObject({ message: "socket closed", cause: "socket closed" })
  })

  it("returns an error that is already classified as it is", () => {
    const queryError = new QueryError("rejected", { code: "22012" })
    const connectionError = new ConnectionError("lost")

    expect(toDriverError(queryError, { severity: "FATAL", code: "57P01" })).toBe(queryError)
    expect(toDriverError(connectionError, { severity: "ERROR", code: "22012" })).toBe(
      connectionError,
    )
  })

  it("returns an error of another copy of kern-orm as it is", () => {
    const queryError = Object.assign(new Error("rejected"), {
      [Symbol.for("kern-orm.QueryError")]: true,
    })

    expect(toDriverError(queryError) as unknown).toBe(queryError)
  })
})
