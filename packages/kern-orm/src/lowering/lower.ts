import type { JoinNode, ProjectionNode, SelectNode } from "../ast/nodes"
import type { AnyDb } from "../execution/db"
import type { QueryNode } from "../query/node"
import { isNestedSelection } from "../query/node"
import type { RelationDefinition } from "../schema/relation"

import { projectRows } from "./nested"
import { sortByPositions } from "./order"

const noJoins: readonly JoinNode[] = /* @__PURE__ */ Object.freeze([])

/**
 * Lowers a query to the SQL select statement that executes it: the statement of `lowerQuery` that sorts by the positions of the projections that have the values of its sort expressions.
 *
 * A selected expression repeated in `ORDER BY` would get parameters of its own, and PostgreSQL may evaluate it again.
 */
export function lowerStatement(
  node: QueryNode,
  definitions?: ReadonlySet<RelationDefinition>,
  db?: AnyDb,
): SelectNode {
  return lowerSelect(node, definitions, db, true)
}

/**
 * Lowers a query to a SQL select statement, packing the rows of each nested query into the value of its field.
 *
 * The statement keeps the sort expressions of the query, which packing reads when the query is nested.
 * With `definitions`, such as the relations of the schema of a `Db`, a query of a relation outside them is rejected at any depth.
 * With `db`, the `Db` that runs the statement, a nested query bound to another `Db` is rejected at any depth.
 */
export function lowerQuery(
  node: QueryNode,
  definitions?: ReadonlySet<RelationDefinition>,
  db?: AnyDb,
): SelectNode {
  return lowerSelect(node, definitions, db, false)
}

/** Lowers a query as `lowerQuery` does, or as `lowerStatement` does when `positions` is set. */
function lowerSelect(
  node: QueryNode,
  definitions: ReadonlySet<RelationDefinition> | undefined,
  db: AnyDb | undefined,
  positions: boolean,
): SelectNode {
  const { relation } = node
  // A relation is checked by identity, so a relation of the same name and keys declared by another schema is rejected.
  if (relation !== undefined && definitions !== undefined && !definitions.has(relation)) {
    throw new Error(`Relation "${relation.key}.${relation.name}" is not part of the schema`)
  }
  const selected = node.projections
  // Without nested queries, the statement shares the projections of the query.
  let lowered: ProjectionNode[] | undefined
  for (let index = 0; index < selected.length; index++) {
    const field = selected[index]!
    if (isNestedSelection(field)) {
      // The statement runs with the options of its Db, such as its PostgreSQL schema, so a query of another Db cannot be nested.
      if (field.db !== undefined && db !== undefined && field.db !== db) {
        throw new Error(`Selected field "${field.key}" is bound to another Db`)
      }
      lowered ??= selected.slice(0, index) as ProjectionNode[]
      lowered.push(projectRows(field.key, lowerSelect(field.query, definitions, db, false)))
    } else if (lowered !== undefined) {
      lowered.push(field)
    }
  }
  const projections = lowered ?? (selected as readonly ProjectionNode[])
  return Object.freeze({
    kind: "select",
    from: node.from,
    joins: noJoins,
    projections,
    filters: node.filters,
    orderBy:
      positions && node.orderBy.length > 0
        ? sortByPositions(node.orderBy, projections)
        : node.orderBy,
    limit: node.limit,
    offset: node.offset,
    rows: node.rows,
    value: node.value,
  })
}
