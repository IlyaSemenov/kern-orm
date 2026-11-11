import { expect, it } from "bun:test"

import { ConnectionError, QueryError } from "./driver-error"
import { isQueryError } from "./error-condition"

/** `QueryError` of the SQLSTATE `code`. */
function createQueryError(code: string): QueryError {
  return new QueryError("rejected", { code })
}

it("tells a QueryError by the condition of its code", () => {
  expect(isQueryError(createQueryError("23505"), "unique_violation")).toBe(true)
  expect(isQueryError(createQueryError("23503"), "unique_violation")).toBe(false)
})

it("matches the condition of a class by every code of the class, also one that the table lacks", () => {
  for (const code of ["23000", "23505", "23599"]) {
    expect(isQueryError(createQueryError(code), "integrity_constraint_violation")).toBe(true)
  }
  expect(isQueryError(createQueryError("23000"), "unique_violation")).toBe(false)
  expect(isQueryError(createQueryError("40001"), "integrity_constraint_violation")).toBe(false)
})

it("matches a condition of two codes by either of them", () => {
  expect(isQueryError(createQueryError("22004"), "null_value_not_allowed")).toBe(true)
  expect(isQueryError(createQueryError("39004"), "null_value_not_allowed")).toBe(true)
})

it("recognizes a QueryError of another copy of kern-db, and no other error with a code", () => {
  const otherCopyError = Object.assign(new Error("duplicate key"), {
    [Symbol.for("kern-db.QueryError")]: true,
    code: "23505",
  })
  const clientError = Object.assign(new Error("duplicate key"), { code: "23505" })

  expect(isQueryError(otherCopyError, "unique_violation")).toBe(true)
  for (const value of [clientError, new ConnectionError("lost"), { code: "23505" }, null]) {
    expect(isQueryError(value, "unique_violation")).toBe(false)
  }
})
