// Semantic query nodes: what a query selects, before lowering turns it into a SQL select statement.
// They share source, expression, and order nodes with the SQL AST, so column references keep pointing to their sources by identity.

import type {
  ExpressionNode,
  MutationStatementNode,
  OrderNode,
  ProjectionNode,
  QueryFilters,
  TableSourceNode,
} from "../ast/nodes"
import { noFilters } from "../ast/nodes"
import type { AnyDb } from "../execution/db"
import type { ResultMode } from "../result/result"
import type { RelationDefinition } from "../schema/relation"

import { getRelationRows } from "./rows"

/** Selection of the rows of a nested query as the value of the field `key`. */
export interface NestedSelectionNode {
  readonly key: string
  readonly query: QueryNode
  /** `Db` that the nested query is bound to, which must be the `Db` that runs the statement. */
  readonly db: AnyDb | undefined
}

/** Field selected by a query: an expression, or the rows of a nested query. */
export type SelectedNode = ProjectionNode | NestedSelectionNode

/** Select query of a table; its result mode applies when it is executed or its rows are nested. */
export interface QueryNode extends ResultMode {
  readonly kind: "query"
  readonly from: TableSourceNode
  /** Relation whose records the query selects, correlated with its parent by the relation filter. */
  readonly relation: RelationDefinition | undefined
  /** Fields in the order of the result, with unique keys; a query without them returns records without fields. */
  readonly projections: readonly SelectedNode[]
  readonly filters: QueryFilters
  readonly orderBy: readonly OrderNode[]
  readonly limit: ExpressionNode | undefined
  readonly offset: ExpressionNode | undefined
  /** Whether a required relation guarantees the row of the query, so that a filter makes a query of rows `one` resolve without it; see `SelectQueryState`. */
  readonly guaranteed: boolean
  /** Whether `all` allows a mutation of the query to change every row of the table without a filter. */
  readonly all: boolean
}

/**
 * Mutation of a table that returns the fields of the rows it changes, which may nest queries, or the number of the rows without them.
 *
 * Its result mode is the rows mode of the rows it changes and whether a row is the value of its only field.
 */
export type MutationNode = MutationStatementNode<SelectedNode>

/** Query of `$select` without a source: one record whose fields are the values of expressions and the rows of independent queries. */
export interface RecordQueryNode {
  readonly kind: "record"
  /** Fields in the order of the record, with unique keys. */
  readonly projections: readonly SelectedNode[]
}

/** Creates a query of all rows of `from`, or of the records of `relation` with `filters` in the rows mode of the relation. */
export function createQueryNode(
  from: TableSourceNode,
  relation?: RelationDefinition,
  filters: QueryFilters = noFilters,
): QueryNode {
  return Object.freeze({
    kind: "query",
    from,
    relation,
    projections: [],
    filters,
    orderBy: [],
    limit: undefined,
    offset: undefined,
    rows: relation === undefined ? "many" : getRelationRows(relation),
    value: false,
    guaranteed: relation?.required ?? false,
    all: false,
  })
}

/** Tells whether `node` is a query of a table without clauses, such as a table of a `Db`: no relation, filters, selected fields, order, limit, offset, rows other than `many`, or `all`. */
export function isTableQuery(node: QueryNode): boolean {
  return (
    node.relation === undefined &&
    node.projections.length === 0 &&
    node.filters.relation === undefined &&
    node.filters.scope === undefined &&
    node.filters.user === undefined &&
    node.orderBy.length === 0 &&
    node.limit === undefined &&
    node.offset === undefined &&
    node.rows === "many" &&
    !node.all
  )
}

/** Tells whether a selected field is the rows of a nested query. */
export function isNestedSelection(node: SelectedNode): node is NestedSelectionNode {
  return "query" in node
}
