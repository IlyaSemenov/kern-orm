import { describe, expect, test } from "bun:test"

import { getThrownError } from "@kern-orm/test-harness/errors"

import { assertNoTransactionControl } from "./adapter"

describe("assertNoTransactionControl", () => {
  test.each([
    "BEGIN",
    "start transaction isolation level serializable",
    "COMMIT",
    "commit and chain",
    "End;",
    "ROLLBACK",
    "ROLLBACK TO SAVEPOINT kern_1",
    "abort",
    "SAVEPOINT orchid",
    "RELEASE SAVEPOINT orchid",
    "PREPARE TRANSACTION 'orchid'",
    "prepare\n\ttransaction 'orchid'",
    " \t\r\n\f\vCOMMIT",
    "-- comment\nCOMMIT",
    "-- comment\rCOMMIT",
    "/* comment */COMMIT",
    "/* outer /* nested */ still comment */ COMMIT",
    "PREPARE /* comment */ TRANSACTION 'orchid'",
    ";COMMIT",
    "; -- comment\n ;\tCOMMIT",
  ])("rejects %j", text => {
    expect(getThrownError(() => assertNoTransactionControl(text))).toEqual(
      new TypeError(
        "The Kern Orchid adapter does not support transaction control statements; use orchid.$transaction or database.transaction",
      ),
    )
  })

  test.each([
    "",
    "SELECT 1",
    "INSERT INTO items (id) VALUES (1)",
    "SELECT 'COMMIT'",
    "-- COMMIT\nSELECT 1",
    "/* COMMIT */ SELECT 1",
    "/* outer /* COMMIT */ */ SELECT 1",
    "PREPARE statement AS SELECT 1",
    "PREPARE transaction AS SELECT 1",
    "PREPARE transaction (integer) AS SELECT $1",
    "PREPARE transactioné AS SELECT 1",
    "commité",
    "committed",
    "begin_work",
  ])("accepts %j", text => {
    expect(() => assertNoTransactionControl(text)).not.toThrow()
  })
})
