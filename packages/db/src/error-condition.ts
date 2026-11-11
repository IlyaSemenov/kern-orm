// Predicate that tells a `QueryError` by the name of its PostgreSQL condition, such as `unique_violation`, rather than by its SQLSTATE.

import { QueryError } from "./driver-error"
import { conditionsByCode } from "./error-condition-codes"

type ConditionsByCode = typeof conditionsByCode

/** Name of a condition of PostgreSQL errors, such as `unique_violation`, or of a class of them, such as `integrity_constraint_violation`. */
export type QueryErrorCondition = ConditionsByCode[keyof ConditionsByCode]

/**
 * SQLSTATE codes of each condition, with every code of its class for the condition of a class.
 *
 * TypeScript computes the map once, whereas a mapped type of the table for each condition would cost a check of another condition about 70 times as many instantiations.
 */
type CodesByCondition = {
  [K in keyof ConditionsByCode as ConditionsByCode[K]]: K extends `${infer Class}000`
    ? `${Class}${string}`
    : K
}

/** SQLSTATE codes of the condition `C`, with every code of its class for the condition of a class. */
export type QueryErrorCode<C extends QueryErrorCondition> = CodesByCondition[C]

/**
 * Tells whether `error` is a `QueryError` of `condition`, including a `QueryError` of another copy of kern-db.
 *
 * The condition of a class, such as `integrity_constraint_violation`, matches every error of its class, as in PL/pgSQL.
 */
export function isQueryError<C extends QueryErrorCondition>(
  error: unknown,
  condition: C,
  // The narrowed `code` keeps a `QueryError` where the check fails: a predicate of `QueryError` alone would narrow it to `never` there.
): error is QueryError & { readonly code: QueryErrorCode<C> } {
  if (!(error instanceof QueryError)) {
    return false
  }
  const conditions: Readonly<Record<string, string>> = conditionsByCode
  // A code that the table lacks, such as of a later version of PostgreSQL, matches only the condition of its class.
  return (
    conditions[error.code] === condition || conditions[`${error.code.slice(0, 2)}000`] === condition
  )
}
