// Nodes and their nested objects are frozen, but their arrays are not, since freezing an array in Bun 1.4.4 costs about 180 ns and makes iterating it about 30 times slower, on every query built and compiled; only their `readonly` types protect them.
// Values of users, such as parameter values and objects of column values, are held by reference and never frozen.

import type { AnyDb } from "../execution/db"
import type { QueryNode } from "../query/node"
import type { ResultField, ResultMode, ScalarField } from "../result/result"
import type { AnyTable } from "../table/table"
import type { AnyType } from "../type/type"

/** Occurrence of a table in `FROM`. */
export interface TableSourceNode {
  readonly kind: "table"
  readonly table: AnyTable
}

/**
 * Occurrence of a subquery in `FROM`, whose columns are the projections of its query, referenced by their keys.
 *
 * A plain one sees only the sources of enclosing queries; a `LATERAL` one also sees the sources before it in the same `FROM`.
 */
export interface DerivedSourceNode {
  readonly kind: "derived"
  readonly query: SelectNode
  readonly lateral: boolean
  /**
   * Occurrence of a table in `FROM` of `query` that the derived source stands for outside it, such as with the rows of a page of the table.
   *
   * Outside `query`, a column reference to the occurrence resolves to the projection of `query` under the key of the column.
   */
  readonly replaces?: TableSourceNode
}

/**
 * One occurrence of a source in `FROM`.
 *
 * Column references point to a source by object identity, so two occurrences of the same table never get confused.
 * The compiler assigns SQL aliases to sources.
 */
export type SourceNode = TableSourceNode | DerivedSourceNode

export interface ColumnRefNode {
  readonly kind: "column"
  readonly source: SourceNode
  /** Key of a column of a table, or of a projection of a derived source. */
  readonly key: string
}

/** Value bound as a query parameter and numbered only when the complete statement is compiled. */
export interface ParamNode {
  readonly kind: "param"
  readonly value: unknown
  readonly type: AnyType | undefined
}

/** Cast of an expression to the `castType` of a type. */
export interface CastNode {
  readonly kind: "cast"
  readonly operand: ExpressionNode
  readonly type: AnyType
}

export interface BooleanNode {
  readonly kind: "boolean"
  readonly value: boolean
}

export interface AndNode {
  readonly kind: "and"
  readonly operands: readonly ExpressionNode[]
}

export interface OrNode {
  readonly kind: "or"
  readonly operands: readonly ExpressionNode[]
}

export interface NotNode {
  readonly kind: "not"
  readonly operand: ExpressionNode
}

/** Equality conditions by column key, resolved against the query source by `where` before compilation. */
export interface ValuesNode {
  readonly kind: "values"
  readonly values: Readonly<Record<string, unknown>>
}

/** Query of a table in an expression, such as of `exists` in a condition, which lowering replaces with the SQL of its value before compilation. */
export interface NestedQueryNode {
  readonly kind: "nestedQuery"
  readonly query: QueryNode
  /** `Db` that the query is bound to, which must be the `Db` that runs the statement. */
  readonly db: AnyDb | undefined
}

export interface ComparisonNode {
  readonly kind: "comparison"
  readonly operator: "=" | "<>" | "<" | "<=" | ">" | ">=" | "LIKE" | "ILIKE"
  readonly left: ExpressionNode
  readonly right: ExpressionNode
}

export interface InNode {
  readonly kind: "in"
  readonly operand: ExpressionNode
  /** Never empty: an empty list is represented as a `FALSE` boolean node. */
  readonly list: readonly ExpressionNode[]
}

export interface IsNullNode {
  readonly kind: "isNull"
  readonly operand: ExpressionNode
}

/** SQL fragment whose interpolations stay structured nodes until compilation. */
export interface RawSqlNode {
  readonly kind: "raw"
  /** Text around interpolations; always one element longer than `values`. */
  readonly fragments: readonly string[]
  readonly values: readonly ExpressionNode[]
}

/** Name of a table interpolated into a SQL fragment, qualified by the PostgreSQL schema of the statement. */
export interface TableNameNode {
  readonly kind: "tableName"
  readonly table: AnyTable
  /** `Db` that the interpolated query of the table is bound to, which must be the `Db` that runs the statement. */
  readonly db: AnyDb | undefined
}

/** Scalar subquery: the value of the only projection of its query, which must return at most one row. */
export interface SubqueryNode {
  readonly kind: "subquery"
  readonly query: SelectNode
}

export interface ExistsNode {
  readonly kind: "exists"
  readonly query: SelectNode
}

/** Call of an aggregate function over the rows of its query, with the order of its input rows. */
export interface AggregateNode {
  readonly kind: "aggregate"
  /** Name of the function, such as `json_agg`. */
  readonly name: string
  /** Whether the function takes each distinct value of its arguments once, as `count(DISTINCT ...)`. */
  readonly distinct: boolean
  readonly arguments: readonly ExpressionNode[]
  readonly orderBy: readonly OrderNode[]
}

export type ExpressionNode =
  | ColumnRefNode
  | ParamNode
  | CastNode
  | BooleanNode
  | AndNode
  | OrNode
  | NotNode
  | ValuesNode
  | NestedQueryNode
  | ComparisonNode
  | InNode
  | IsNullNode
  | RawSqlNode
  | TableNameNode
  | SubqueryNode
  | ExistsNode
  | AggregateNode

/**
 * Filters of a query, kept apart so that composing one kind never changes the others.
 *
 * The effective predicate is `relation AND scope AND user`.
 * In particular, a user `OR` cannot bypass a relation condition.
 */
export interface QueryFilters {
  /** Correlation with the parent query of a relation. */
  readonly relation?: ExpressionNode
  /** Mandatory restrictions such as soft delete. */
  readonly scope?: ExpressionNode
  /** Conditions added with `where`. */
  readonly user?: ExpressionNode
}

/**
 * Expression selected under the key of a result field.
 *
 * The key names only the field of the result record: it never shadows a column of a source.
 */
export type ProjectionNode = ResultField & { readonly expression: ExpressionNode }

/** Projection of a scalar expression, decoded by its type. */
export type ScalarProjection = ScalarField & { readonly expression: ExpressionNode }

/** Source joined with `LEFT JOIN` to the sources before it; its `ON` condition sees them and the joined source. */
export interface JoinNode {
  readonly type: "left"
  readonly source: SourceNode
  readonly on: ExpressionNode
}

/** Sort key of `ORDER BY`; `nulls` overrides the placement of `NULL` that PostgreSQL derives from the direction. */
export interface OrderNode {
  readonly expression: ExpressionNode
  readonly direction: "asc" | "desc"
  readonly nulls: "first" | "last" | undefined
}

/** Select query; its result mode applies only when it is executed or its rows are packed. */
export interface SelectNode<
  From extends SourceNode | undefined = SourceNode | undefined,
> extends ResultMode {
  readonly kind: "select"
  /** Source of `FROM`; a query without it has no joins. */
  readonly from: From
  readonly joins: readonly JoinNode[]
  /** Projections in the order of the result fields, with unique keys; a query without them returns records without fields. */
  readonly projections: readonly ProjectionNode[]
  readonly filters: QueryFilters
  readonly orderBy: readonly OrderNode[]
  // PostgreSQL evaluates them before the rows of the query, so they see only the sources of enclosing queries.
  readonly limit: ExpressionNode | undefined
  readonly offset: ExpressionNode | undefined
  /** Required relation that guarantees the row of the query, such as `field.form`; see `ResultPlan`. */
  readonly guaranteedBy: string | undefined
}

/** Assignment of `SET` of an update: the value of the column under `key`. */
export interface AssignmentNode {
  readonly key: string
  readonly value: ExpressionNode
}

/**
 * Parts of a mutation statement of the table occurrence `target`, which its expressions refer to, and the result mode of the rows it changes.
 *
 * `returning` holds the fields of `RETURNING` of type `Field`, nested queries of a semantic mutation before lowering, or `undefined` for a statement that returns the number of the rows it changes.
 */
interface MutationParts<Field> extends ResultMode {
  readonly target: TableSourceNode
  readonly returning: readonly Field[] | undefined
}

/** Insert statement of rows of `VALUES`. */
export interface InsertNode<Field = ProjectionNode> extends MutationParts<Field> {
  readonly kind: "insert"
  /** Keys of the columns of `VALUES`; none for a row of the defaults of every column. */
  readonly columns: readonly string[]
  /** Rows of `VALUES`, at least one, each with a value of every column in their order, or `undefined` for `DEFAULT`. */
  readonly values: readonly (readonly (ExpressionNode | undefined)[])[]
}

/** Update statement of the rows that its filters choose. */
export interface UpdateNode<Field = ProjectionNode> extends MutationParts<Field> {
  readonly kind: "update"
  /** Assignments of `SET`, at least one, with unique keys. */
  readonly set: readonly AssignmentNode[]
  readonly filters: QueryFilters
}

/** Delete statement of the rows that its filters choose. */
export interface DeleteNode<Field = ProjectionNode> extends MutationParts<Field> {
  readonly kind: "delete"
  readonly filters: QueryFilters
}

/** Statement that inserts, updates, or deletes rows, with the fields of `RETURNING` of type `Field`. */
export type MutationStatementNode<Field = ProjectionNode> =
  | InsertNode<Field>
  | UpdateNode<Field>
  | DeleteNode<Field>

/**
 * Statement of SQL text written by a user, such as of `$query`.
 *
 * Its result mode is the rows mode of the rows that the statement returns and whether a row is the value of its only column.
 */
export interface TextStatementNode extends ResultMode {
  readonly kind: "text"
  readonly sql: RawSqlNode
  /** Fields decoded from the result columns of their keys, or from the only column for a value; `undefined` for a statement that resolves to the number of the rows of its command tag. */
  readonly fields: readonly ScalarField[] | undefined
}

/** Statement that the compiler compiles: a select statement, a mutation, or a statement of SQL text. */
export type StatementNode = SelectNode | MutationStatementNode | TextStatementNode

/** Freezes an expression node; nodes are shared between queries and never change. */
export function createNode<N extends ExpressionNode>(node: N): N {
  return Object.freeze(node)
}

/** Creates SQL of `items` separated by commas between `prefix` and `suffix`, such as the arguments of a function call. */
export function createList(
  prefix: string,
  items: readonly ExpressionNode[],
  suffix: string,
): RawSqlNode {
  if (items.length === 0) {
    return createNode({ kind: "raw", fragments: [prefix + suffix], values: [] })
  }
  const fragments = [prefix]
  for (let index = 1; index < items.length; index++) {
    fragments.push(", ")
  }
  fragments.push(suffix)
  return createNode({ kind: "raw", fragments, values: items })
}

/** Filters of a query without conditions. */
export const noFilters: QueryFilters = /* @__PURE__ */ Object.freeze({})

/** Creates a query of all rows of `from` with `projections`. */
export function createSelectNode<From extends SourceNode>(
  from: From,
  projections: readonly ProjectionNode[] = [],
): SelectNode<From> {
  return Object.freeze({
    kind: "select",
    from,
    joins: [],
    projections,
    filters: noFilters,
    orderBy: [],
    limit: undefined,
    offset: undefined,
    rows: "many",
    value: false,
    guaranteedBy: undefined,
  })
}

export const trueNode = /* @__PURE__ */ createNode<BooleanNode>({ kind: "boolean", value: true })

export const falseNode = /* @__PURE__ */ createNode<BooleanNode>({ kind: "boolean", value: false })

/** Number `1`, such as the limit of a query of one row. */
export const oneNode = /* @__PURE__ */ createNode<RawSqlNode>({
  kind: "raw",
  fragments: ["1"],
  values: [],
})
