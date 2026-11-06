// Row locks of select queries: the strengths and options of `forUpdate` and the other locks, and the queries they apply to.

import type { RowLockNode } from "../ast/nodes"

import { isAggregateQuery } from "./aggregate"
import { isExistsQuery } from "./exists"
import type { QueryNode } from "./node"

/**
 * What a query with a row lock does with a row that another transaction has locked, instead of waiting for it:
 *
 * - `skipLocked` leaves the row out of its result, such as to take the next free job of a queue.
 * - `noWait` rejects with a PostgreSQL error of SQLSTATE `55P03`.
 */
export type RowLockOptions =
  | { readonly noWait?: boolean; readonly skipLocked?: false }
  | { readonly noWait?: false; readonly skipLocked?: boolean }

// PostgreSQL rejects a lock beside an aggregate and `DISTINCT`, whose rows come from several rows of a table, whereas `EXISTS` takes it and locks only the first row that it finds.
/** Creates the row lock of `strength` for `method`, rejecting a query whose rows it cannot lock and options that contradict each other. */
export function createRowLock(
  node: QueryNode,
  method: string,
  strength: RowLockNode["strength"],
  options: RowLockOptions = {},
): RowLockNode {
  if (isAggregateQuery(node)) {
    throw new Error(`${method} cannot be used after an aggregate`)
  }
  if (isExistsQuery(node)) {
    throw new Error(`${method} cannot be used after exists`)
  }
  if (node.distinct) {
    throw new Error(
      `${method} cannot be used after distinct, since a row without duplicates comes from several rows of the table`,
    )
  }
  const { noWait, skipLocked } = options
  if (noWait && skipLocked) {
    throw new Error(`${method} takes either noWait or skipLocked, not both`)
  }
  return Object.freeze({
    strength,
    onLocked: noWait ? "NOWAIT" : skipLocked ? "SKIP LOCKED" : undefined,
  })
}
