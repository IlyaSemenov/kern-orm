import { describe, expectTypeOf, test } from "bun:test"

import type { QueryError } from "./driver-error"
import { isQueryError } from "./error-condition"

declare const error: unknown
declare const queryError: QueryError

describe("isQueryError", () => {
  test("narrows the code of the error to the codes of the condition", () => {
    if (isQueryError(error, "unique_violation")) {
      expectTypeOf(error).toExtend<QueryError>()
      expectTypeOf(error.code).toEqualTypeOf<"23505">()
    }
    if (isQueryError(error, "null_value_not_allowed")) {
      expectTypeOf(error.code).toEqualTypeOf<"22004" | "39004">()
    }
    if (isQueryError(error, "integrity_constraint_violation")) {
      expectTypeOf(error.code).toEqualTypeOf<`23${string}`>()
    }
    if (isQueryError(error, "transaction_rollback")) {
      expectTypeOf(error.code).toEqualTypeOf<`40${string}`>()
    }
  })

  test("keeps a QueryError where the check fails", () => {
    if (!isQueryError(queryError, "unique_violation")) {
      expectTypeOf(queryError).toEqualTypeOf<QueryError>()
    }
  })

  test("takes only the conditions of PostgreSQL", () => {
    // @ts-expect-error a misspelled condition
    isQueryError(error, "unique_violaton")
  })
})
