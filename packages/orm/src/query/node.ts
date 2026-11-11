// Semantic query nodes: what a query selects, before lowering turns it into a SQL select statement.
// They share source, expression, and order nodes with the SQL AST, so column references keep pointing to their sources by identity.

import type { ResultMode } from "kern-db/builder"

import type {
  ExpressionNode,
  MutationStatementNode,
  OrderNode,
  ProjectionNode,
  QueryFilters,
  RowLockNode,
  TableSourceNode,
} from "../ast/nodes"
import { noFilters } from "../ast/nodes"
import type { AnyDb } from "../execution/db"
import type { ResultConversion } from "../result/result"
import type { RelationDefinition } from "../schema/relation"

import { getRelationRows, getTableRows } from "./rows"

/** Selection of the rows of a nested query as the value of the field `key`. */
export interface NestedSelectionNode {
  readonly key: string
  readonly query: QueryNode
  /** `Db` that the nested query is bound to, which must be the `Db` that runs the statement. */
  readonly db: AnyDb | undefined
}

/** Selection of a value from code as the field `key` of every record, which a statement does not select. */
export interface LiteralSelectionNode {
  readonly key: string
  readonly literal: unknown
}

/** Field that a statement selects: an expression, or the rows of a nested query. */
export type SqlSelectedNode = ProjectionNode | NestedSelectionNode

/** Field selected by a query: one that its statement selects, or a literal. */
export type SelectedNode = SqlSelectedNode | LiteralSelectionNode

/** Select query of a table; its result mode applies when it is executed or its rows are nested. */
export interface QueryNode extends ResultMode {
  readonly kind: "query"
  readonly from: TableSourceNode
  /** Relation whose records the query selects, correlated with its parent by the relation filter. */
  readonly relation: RelationDefinition | undefined
  /** Fields in the order of the result, with unique keys; a query without them returns records without fields. */
  readonly projections: readonly SelectedNode[]
  readonly filters: QueryFilters
  /** Keys of the groups of the rows; a query with them gives one row of each group. */
  readonly groupBy: readonly ExpressionNode[]
  /** Condition of the groups, apart from `filters`, which choose the rows that they group. */
  readonly having: ExpressionNode | undefined
  readonly orderBy: readonly OrderNode[]
  readonly limit: ExpressionNode | undefined
  readonly offset: ExpressionNode | undefined
  /** Whether `distinct` removes the duplicates of the rows, comparing the fields that the query selects when it compiles. */
  readonly distinct: boolean
  /** Keys of `distinctOn`, whose equal values give one row, the first in the order of the query; none without `distinctOn`. */
  readonly distinctOn: readonly ExpressionNode[]
  /**
   * Fields of a query of `distinct` or `distinctOn` that an aggregate method or `exists` replaced, or `undefined` otherwise.
   *
   * `distinct` compares them, and the keys, the order, and the argument of the aggregate read a selected field through its projection.
   */
  readonly distinctFields: readonly SelectedNode[] | undefined
  /** Lock of the rows that the query reads. */
  readonly lock: RowLockNode | undefined
  /** Whether a required relation guarantees the row of the query, so that a filter makes a query of rows `one` resolve without it; see `SelectQueryState`. */
  readonly guaranteed: boolean
  /** Whether `all` allows a mutation of the query to change every row of the table without a filter. */
  readonly all: boolean
  /** How `map` and `transform` convert the decoded result. */
  readonly conversion: ResultConversion | undefined
  /**
   * Values of the columns of the key of `find` or `findBy` of a query of a table without clauses, which `upsert` inserts, an empty object for a query that starts from a singleton table, whose key has no columns, or `undefined` for any other query.
   *
   * Every method that derives a node from the query drops them, whereas `use` returns the query of its callback, such as the query itself.
   */
  readonly foundKey: Readonly<Record<string, unknown>> | undefined
}

/**
 * Mutation of a table that returns the fields of the rows it changes, which may nest queries, or the number of the rows without them.
 *
 * Its result mode is the rows mode of the rows it changes and whether a row is the value of its only field.
 */
export type MutationNode = MutationStatementNode<SelectedNode>

/** Query of `$select` without a source: one record whose fields are the values of expressions, the rows of independent queries, and literals. */
export interface RecordQueryNode {
  readonly kind: "record"
  /** Fields in the order of the record, with unique keys. */
  readonly projections: readonly SelectedNode[]
}

/** Empty values of the key without columns of a query that starts from a singleton table. */
const singletonKey: Readonly<Record<string, unknown>> = /* @__PURE__ */ Object.freeze({})

/**
 * Creates a query of all rows of `from`, or of the records of `relation` with `filters` in the rows mode of the relation.
 *
 * A query of a singleton table without `relation` is a query of its one row, as of `find` of a key without columns, which `upsert` applies to.
 */
export function createQueryNode(
  from: TableSourceNode,
  relation?: RelationDefinition,
  filters: QueryFilters = noFilters,
): QueryNode {
  const singleton = relation === undefined && from.table.singleton
  return Object.freeze({
    kind: "query",
    from,
    relation,
    projections: [],
    filters,
    groupBy: [],
    having: undefined,
    orderBy: [],
    limit: undefined,
    offset: undefined,
    distinct: false,
    distinctOn: [],
    distinctFields: undefined,
    lock: undefined,
    rows: relation === undefined ? getTableRows(from.table) : getRelationRows(relation),
    value: false,
    guaranteed: relation?.required ?? false,
    all: false,
    conversion: undefined,
    foundKey: singleton ? singletonKey : undefined,
  })
}

/** Tells whether `node` is a query of a table without clauses, such as a table of a `Db`: no relation, filters, selected fields, keys of groups, order, limit, offset, `distinct`, keys of `distinctOn`, row lock, rows other than those that the table starts with, `many` or `optional` of a singleton table, `all`, or conversion. */
export function isTableQuery(node: QueryNode): boolean {
  return (
    node.relation === undefined &&
    node.projections.length === 0 &&
    node.filters.relation === undefined &&
    node.filters.scope === undefined &&
    node.filters.user === undefined &&
    node.groupBy.length === 0 &&
    node.orderBy.length === 0 &&
    node.limit === undefined &&
    node.offset === undefined &&
    !node.distinct &&
    node.distinctOn.length === 0 &&
    node.lock === undefined &&
    node.rows === getTableRows(node.from.table) &&
    !node.all &&
    node.conversion === undefined
  )
}

/** Tells whether a selected field is the rows of a nested query. */
export function isNestedSelection(node: SelectedNode): node is NestedSelectionNode {
  return "query" in node
}

/** Tells whether a selected field is a literal. */
export function isLiteralSelection(node: SelectedNode): node is LiteralSelectionNode {
  return "literal" in node
}
