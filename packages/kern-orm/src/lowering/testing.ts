import type { SelectNode, SourceNode } from "../ast/nodes"
import type { AnySelectQuery } from "../query/select"

import { lowerQuery } from "./lower"

/** Lowers the node of `query`, a query of the rows of a table rather than of `exists`, to a SQL select statement, such as one to compile or to nest in the SQL AST by hand. */
export function lower(query: AnySelectQuery): SelectNode<SourceNode> {
  const node = lowerQuery(query.node)
  if (node.from === undefined) {
    throw new Error("lower takes a query of the rows of a table, not of exists")
  }
  return node as SelectNode<SourceNode>
}
