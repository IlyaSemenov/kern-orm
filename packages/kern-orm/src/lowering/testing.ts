import type { SelectNode } from "../ast/nodes"
import type { AnySelectQuery } from "../query/select"

import { lowerQuery } from "./lower"

/** Lowers the node of `query` to a SQL select statement, such as one to compile or to nest in the SQL AST by hand. */
export function lower(query: AnySelectQuery): SelectNode {
  return lowerQuery(query.node)
}
