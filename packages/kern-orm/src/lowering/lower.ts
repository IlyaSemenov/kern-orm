// Lowering of a query, a mutation, or a statement of SQL text to the SQL statement that executes it.

import type {
  RawSqlNode,
  SelectNode,
  StatementNode,
  TableSourceNode,
  TextStatementNode,
} from "../ast/nodes"
import { noFilters, noJoins, noOrder } from "../ast/nodes"
import type { AnyDb } from "../execution/db"
import { isAggregateQuery } from "../query/aggregate"
import { isExistsQuery } from "../query/exists"
import type { MutationNode, QueryNode, RecordQueryNode } from "../query/node"
import type { RelationDefinition } from "../schema/relation"
import { formatRelationName } from "../schema/relation"

import { lowerAggregate } from "./aggregate"
import type { LoweringContext } from "./context"
import { checkRelation } from "./context"
import { checkDistinct, checkDistinctOn } from "./distinct"
import { lowerExists } from "./exists"
import { lowerExpression, lowerFilters, lowerKeys, lowerOrder, lowerValue } from "./expression"
import { lowerMutation } from "./mutation"
import { sortByPositions } from "./order"
import { lowerPage } from "./page"
import { createRecordTemplate, dropLiterals, lowerProjections, projectExists } from "./projection"

/**
 * Lowers a query to the SQL statement that executes it: the select statement of `lowerQuery` that sorts by the positions of the projections that have the values of its sort expressions, the statement without a source of a query of `$select`, the statement of a mutation, or a statement of SQL text.
 *
 * A selected expression repeated in `ORDER BY` would get parameters of its own, and PostgreSQL may evaluate it again.
 * It replaces and checks the queries nested in every statement as `lowerQuery` does.
 */
export function lowerStatement(
  node: QueryNode | RecordQueryNode,
  definitions?: ReadonlySet<RelationDefinition>,
  db?: AnyDb,
): SelectNode
export function lowerStatement(
  node: QueryNode | RecordQueryNode | MutationNode | TextStatementNode,
  definitions?: ReadonlySet<RelationDefinition>,
  db?: AnyDb,
): StatementNode
export function lowerStatement(
  node: QueryNode | RecordQueryNode | MutationNode | TextStatementNode,
  definitions?: ReadonlySet<RelationDefinition>,
  db?: AnyDb,
): StatementNode {
  const context = createContext(definitions, db)
  switch (node.kind) {
    case "query":
      return lowerSelect(node, context, true)
    case "record":
      return lowerRecord(node, context)
    case "text":
      return lowerText(node, context)
    default:
      return lowerMutation(node, context)
  }
}

/**
 * Lowers a query to a SQL select statement, packing the rows of each nested query into the value of its field, or selecting the value of a nested aggregate query or `EXISTS` of a nested query of `exists`, and replacing each query in an expression, such as in a condition, with `EXISTS` or a scalar subquery.
 * A query of records or of rows `many` in SQL text becomes its statement in parentheses.
 *
 * The statement of a query other than an aggregate query or a query of `exists` keeps the sort expressions of the query, which packing reads when the query is nested.
 * With `definitions`, such as the relations of the schema of a `Db`, a query of a relation outside them is rejected at any depth.
 * With `db`, the `Db` that runs the statement, a nested query bound to another `Db` is rejected at any depth; without it, such as for `toSQL` of an unbound query, a nested query bound to any `Db` is.
 */
export function lowerQuery(
  node: QueryNode,
  definitions?: ReadonlySet<RelationDefinition>,
  db?: AnyDb,
): SelectNode {
  return lowerSelect(node, createContext(definitions, db), false)
}

/** Creates the context of lowering a statement with `definitions` and `db`, whose nested queries `lowerSelect` lowers. */
function createContext(
  definitions: ReadonlySet<RelationDefinition> | undefined,
  db: AnyDb | undefined,
): LoweringContext {
  const context: LoweringContext = {
    definitions,
    db,
    lowerSelect: (node, positions) => lowerSelect(node, context, positions),
    lowerExists: node => lowerExists(node, context),
  }
  return context
}

/** Lowers a statement of SQL text, replacing the queries in the expressions interpolated into it. */
function lowerText(node: TextStatementNode, context: LoweringContext): TextStatementNode {
  // Lowering keeps the kind of a node of SQL text.
  const sql = lowerExpression(node.sql, context) as RawSqlNode
  if (sql === node.sql) {
    return node
  }
  return Object.freeze({
    kind: "text",
    sql,
    fields: node.fields,
    rows: node.rows,
    value: node.value,
  })
}

/** Lowers a query as `lowerQuery` does, or as `lowerStatement` does when `positions` is set, with the conversion of its result. */
function lowerSelect(node: QueryNode, context: LoweringContext, positions: boolean): SelectNode {
  const statement = lowerSelectStatement(node, context, positions)
  const { conversion } = node
  return conversion === undefined ? statement : Object.freeze({ ...statement, conversion })
}

/** Lowers a query to its statement, whichever it is: of `exists`, of an aggregate, of a page that evaluates its nested queries only over its rows, or of the rows of its source. */
function lowerSelectStatement(
  node: QueryNode,
  context: LoweringContext,
  positions: boolean,
): SelectNode {
  if (isExistsQuery(node)) {
    return selectExists(node, context)
  }
  checkRelation(node, context)
  if (isAggregateQuery(node)) {
    return lowerAggregate(node, context)
  }
  const recordTemplate = createRecordTemplate(node.projections)
  const selected = dropLiterals(node.projections)
  const projections = lowerProjections(selected, context)
  const filters = lowerFilters(node.filters, context)
  const orderBy = lowerOrder(node.orderBy, context, selected, projections)
  const groupBy = lowerKeys(node.groupBy, context, selected, projections)
  const having = lowerValue(node.having, context)
  const distinctOn = lowerKeys(node.distinctOn, context, selected, projections)
  if (node.distinct) {
    checkDistinct(projections, orderBy)
  }
  if (distinctOn !== undefined) {
    checkDistinctOn(projections, distinctOn, orderBy)
  }
  const { relation } = node
  // Without its row, such a query breaks the promise of the relation rather than missing a record it looks up.
  const guaranteedBy =
    node.guaranteed && relation !== undefined
      ? formatRelationName(relation.key, relation.name)
      : undefined
  // `lowerPage` reads the order of the sort expressions, so the statement takes the order of positions only after it, before it is frozen.
  const statement: {
    -readonly [K in keyof SelectNode<TableSourceNode>]: SelectNode<TableSourceNode>[K]
  } = {
    kind: "select",
    from: node.from,
    joins: noJoins,
    projections,
    filters,
    groupBy,
    having,
    orderBy,
    limit: node.limit,
    offset: node.offset,
    distinct: node.distinct,
    distinctOn,
    lock: node.lock,
    rows: node.rows,
    value: node.value,
    guaranteedBy,
    recordTemplate,
  }
  const page = lowerPage(statement, selected, positions)
  if (page !== undefined) {
    return page
  }
  if (positions && orderBy.length > 0) {
    statement.orderBy = sortByPositions(orderBy, projections)
  }
  return Object.freeze(statement)
}

/** Lowers a query of `exists` to a statement without a source of one row of `EXISTS` of its rows. */
function selectExists(node: QueryNode, context: LoweringContext): SelectNode<undefined> {
  return Object.freeze({
    kind: "select",
    from: undefined,
    joins: noJoins,
    projections: [projectExists(node.projections[0]!.key, node, context)],
    filters: noFilters,
    orderBy: noOrder,
    limit: undefined,
    offset: undefined,
    rows: node.rows,
    value: true,
    guaranteedBy: undefined,
  })
}

/** Lowers a query of `$select` to a statement without a source, which returns one row of its fields. */
function lowerRecord(node: RecordQueryNode, context: LoweringContext): SelectNode<undefined> {
  return Object.freeze({
    kind: "select",
    from: undefined,
    joins: noJoins,
    projections: lowerProjections(dropLiterals(node.projections), context),
    filters: noFilters,
    orderBy: noOrder,
    limit: undefined,
    offset: undefined,
    rows: "one",
    value: false,
    guaranteedBy: undefined,
    recordTemplate: createRecordTemplate(node.projections),
  })
}
