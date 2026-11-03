import type {
  AggregateNode,
  AssignmentNode,
  ExistsNode,
  ExpressionNode,
  JoinNode,
  MutationStatementNode,
  NestedQueryNode,
  OrderNode,
  ProjectionNode,
  QueryFilters,
  RawSqlNode,
  ScalarProjection,
  SelectNode,
  SourceNode,
  StatementNode,
  TextStatementNode,
} from "../ast/nodes"
import { createList, createNode, noFilters } from "../ast/nodes"
import { collectColumnKeys, holdsFragmentOfSource } from "../ast/references"
import type { AnyDb } from "../execution/db"
import type { AggregateProjection } from "../query/aggregate"
import { countProjection, isAggregateQuery } from "../query/aggregate"
import { isExistsQuery } from "../query/exists"
import type { MutationNode, QueryNode, RecordQueryNode, SelectedNode } from "../query/node"
import { isNestedSelection } from "../query/node"
import type { RelationDefinition } from "../schema/relation"
import { formatRelationName } from "../schema/relation"
import { text } from "../type/builtins/text"

import { projectRows } from "./nested"
import { deriveOrderedSource, sortByPositions } from "./order"

const noJoins: readonly JoinNode[] = /* @__PURE__ */ Object.freeze([])

const noOrder: readonly OrderNode[] = /* @__PURE__ */ Object.freeze([])

const noProjections: readonly ProjectionNode[] = /* @__PURE__ */ Object.freeze([])

/** What lowering checks the queries of a statement against at any depth. */
interface LoweringContext {
  /** Relation definitions whose records the queries may select, such as the relations of the schema of a `Db`, or `undefined` for any. */
  readonly definitions: ReadonlySet<RelationDefinition> | undefined
  /** `Db` that runs the statement, the only one whose bound queries the statement may nest, or `undefined` for none, such as for `toSQL` of an unbound query. */
  readonly db: AnyDb | undefined
}

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
  const context: LoweringContext = { definitions, db }
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
  return lowerSelect(node, { definitions, db }, false)
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

/** Lowers a mutation to its statement, replacing the queries in its expressions, and packing the rows of each nested query of `RETURNING` into the value of its field, or selecting the value of a nested aggregate query, as a select list does. */
function lowerMutation(node: MutationNode, context: LoweringContext): MutationStatementNode {
  const { target, returning, rows, value } = node
  const lowered = returning === undefined ? undefined : lowerProjections(returning, context)
  switch (node.kind) {
    case "insert": {
      const values = lowerEach(node.values, context, lowerRow)
      // Without queries, the fields are already projections and the node is the statement.
      if (lowered === returning && values === node.values) {
        return node as MutationStatementNode
      }
      return Object.freeze({
        kind: "insert",
        target,
        columns: node.columns,
        values,
        returning: lowered,
        rows,
        value,
      })
    }
    case "update": {
      const set = lowerEach(node.set, context, lowerAssignment)
      const filters = lowerFilters(node.filters, context)
      if (lowered === returning && set === node.set && filters === node.filters) {
        return node as MutationStatementNode
      }
      return Object.freeze({
        kind: "update",
        target,
        set,
        filters,
        returning: lowered,
        rows,
        value,
      })
    }
    case "delete": {
      const filters = lowerFilters(node.filters, context)
      if (lowered === returning && filters === node.filters) {
        return node as MutationStatementNode
      }
      return Object.freeze({
        kind: "delete",
        target,
        filters,
        returning: lowered,
        rows,
        value,
      })
    }
    default:
      return node satisfies never
  }
}

/** Lowers a row of `VALUES` of an insert, whose `undefined` stands for `DEFAULT`. */
function lowerRow(
  row: readonly (ExpressionNode | undefined)[],
  context: LoweringContext,
): readonly (ExpressionNode | undefined)[] {
  return lowerEach(row, context, lowerValue)
}

function lowerValue(
  node: ExpressionNode | undefined,
  context: LoweringContext,
): ExpressionNode | undefined {
  return node === undefined ? undefined : lowerExpression(node, context)
}

function lowerAssignment(assignment: AssignmentNode, context: LoweringContext): AssignmentNode {
  const value = lowerExpression(assignment.value, context)
  return value === assignment.value ? assignment : Object.freeze({ key: assignment.key, value })
}

/** Lowers a query as `lowerQuery` does, or as `lowerStatement` does when `positions` is set. */
function lowerSelect(node: QueryNode, context: LoweringContext, positions: boolean): SelectNode {
  if (isExistsQuery(node)) {
    return selectExists(node, context)
  }
  checkRelation(node, context)
  if (isAggregateQuery(node)) {
    return lowerAggregate(node, context)
  }
  const selected = node.projections
  const projections = lowerProjections(selected, context)
  const filters = lowerFilters(node.filters, context)
  const orderBy = lowerOrder(node.orderBy, context, selected, projections)
  const { relation } = node
  // Without its row, such a query breaks the promise of the relation rather than missing a record it looks up.
  const guaranteedBy =
    node.guaranteed && relation !== undefined
      ? formatRelationName(relation.key, relation.name)
      : undefined
  // PostgreSQL evaluates the select list also for the rows that an offset skips, so the nested queries of a page after an offset read its rows from a derived source.
  const page =
    node.offset !== undefined && selected.some(isNestedSelection)
      ? lowerPage(node, projections, filters, orderBy, positions, guaranteedBy)
      : undefined
  if (page !== undefined) {
    return page
  }
  return Object.freeze({
    kind: "select",
    from: node.from,
    joins: noJoins,
    projections,
    filters,
    orderBy: positions && orderBy.length > 0 ? sortByPositions(orderBy, projections) : orderBy,
    limit: node.limit,
    offset: node.offset,
    rows: node.rows,
    value: node.value,
    guaranteedBy,
  })
}

/** Rejects a query of a relation outside the definitions of `context`. */
function checkRelation(node: QueryNode, context: LoweringContext): void {
  const { relation } = node
  const { definitions } = context
  // A relation is checked by identity, so a relation of the same name and keys declared by another schema is rejected.
  if (relation !== undefined && definitions !== undefined && !definitions.has(relation)) {
    throw new Error(
      `Relation "${formatRelationName(relation.key, relation.name)}" is not part of the schema`,
    )
  }
}

// The statement runs with the options of its Db, such as its PostgreSQL schema, so a nested query bound to a Db runs only in a statement of that Db.
/** Rejects a nested query bound to `db`, which the error names as `subject`, unless `db` is the `Db` of `context` or `undefined`. */
function checkDb(db: AnyDb | undefined, context: LoweringContext, subject: string): void {
  if (db !== undefined && db !== context.db) {
    throw new Error(
      context.db === undefined
        ? `${subject} is bound to a Db, so only that Db can compile the query`
        : `${subject} is bound to another Db`,
    )
  }
}

/**
 * Lowers `node` with `projections`, `filters`, and `orderBy`, the lowered parts of the node, to a statement that evaluates its nested queries over the rows of a derived page.
 * The derived source applies the filters, the order, the limit, and the offset, and replaces the occurrence of the table.
 *
 * It returns `undefined` when a nested query holds a SQL fragment that refers to a column of the table outside the queries nested in the fragment.
 * Such a fragment may hold an aggregate of the query, which the limit and the offset apply after.
 *
 * The source selects the columns of the table that the fields and the nested queries of the query read, under their keys, and the other scalar fields of the query, which it evaluates before the limit and the offset as the query would, such as a window function over all its rows.
 * A column that no field reads stays out of the source, which could not select it beside an aggregate of a SQL fragment, such as `count(*)`.
 * The order of a derived source does not carry into the query that reads it, so the statement sorts the rows of the page again by the sort keys of the source, by positions when `positions` is set.
 */
function lowerPage(
  node: QueryNode,
  projections: readonly ProjectionNode[],
  filters: QueryFilters,
  orderBy: readonly OrderNode[],
  positions: boolean,
  guaranteedBy: string | undefined,
): SelectNode<SourceNode> | undefined {
  const { from } = node
  const columnKeys = new Set<string>()
  const fields: ScalarProjection[] = []
  // Keys of the source of the scalar fields other than columns of the table, by the position of the field, which no column key takes.
  const fieldKeys: (string | undefined)[] = []
  for (let index = 0; index < projections.length; index++) {
    const { expression } = projections[index]!
    let key: string | undefined
    if (isNestedSelection(node.projections[index]!)) {
      if (holdsFragmentOfSource(expression, from)) {
        return undefined
      }
      collectColumnKeys(expression, from, columnKeys)
    } else if (expression.kind === "column" && expression.source === from) {
      columnKeys.add(expression.key)
    } else {
      key = `$field${index + 1}`
      // A projection of the source is never decoded, so its type `text` only completes it.
      fields.push(Object.freeze({ key, expression, type: text }))
    }
    fieldKeys.push(key)
  }
  const sourced: ScalarProjection[] = []
  for (const key of columnKeys) {
    sourced.push(
      Object.freeze({
        key,
        expression: createNode({ kind: "column", source: from, key }),
        type: text,
      }),
    )
  }
  for (const field of fields) {
    sourced.push(field)
  }
  const page = deriveOrderedSource(
    {
      kind: "select",
      from,
      joins: noJoins,
      projections: sourced,
      filters,
      orderBy,
      limit: node.limit,
      offset: node.offset,
      rows: "many",
      value: false,
      guaranteedBy: undefined,
    },
    true,
    node.offset,
    from,
  )
  const selected: ProjectionNode[] = []
  for (let index = 0; index < projections.length; index++) {
    const projection = projections[index]!
    const key = fieldKeys[index]
    selected.push(
      key === undefined
        ? projection
        : Object.freeze({
            key: projection.key,
            expression: createNode({ kind: "column", source: page.source, key }),
            type: (projection as ScalarProjection).type,
          }),
    )
  }
  return Object.freeze({
    kind: "select",
    from: page.source,
    joins: noJoins,
    projections: selected,
    filters: noFilters,
    orderBy: positions ? sortByPositions(page.order, selected) : page.order,
    limit: undefined,
    offset: undefined,
    rows: node.rows,
    value: node.value,
    guaranteedBy,
  })
}

// PostgreSQL rejects sorting by a column beside an aggregate, so the statement has no order: the order only chooses the rows of a page and orders the input of an ordered aggregate.
/** Lowers an aggregate query to a statement of the value of its aggregate over the rows that its filters, limit, and offset choose. */
function lowerAggregate(node: QueryNode, context: LoweringContext): SelectNode<SourceNode> {
  // The only projection of an aggregate query is the projection of the aggregate.
  const field = node.projections[0] as AggregateProjection
  const aggregate = field.expression
  const orderBy = lowerOrder(node.orderBy, context)
  let from: SourceNode = node.from
  let filters = lowerFilters(node.filters, context)
  let args = lowerEach(aggregate.arguments, context, lowerExpression)
  let order = field.ordered ? orderBy : noOrder
  // The projection of `count(*)` is replaced when a fallback is added, while its call stays.
  const counted = aggregate === countProjection.expression
  // An aggregate takes the rows before the limit and the offset of its own query, so it reads the rows of a page from a derived source of them.
  // PostgreSQL assigns an aggregate to the innermost query whose sources its arguments refer to, so an argument that refers only to the sources of enclosing queries, such as a column of the parent row, is read from a derived source as well, whose column the aggregate takes.
  if (
    node.limit !== undefined ||
    node.offset !== undefined ||
    (!counted && !refersToSource(args[0]!, node.from))
  ) {
    // `count(*)` reads no values of the rows, and the number of the rows of a page does not depend on their order.
    const projections: ScalarProjection[] = []
    if (!counted) {
      // The source names the value of the first argument by the key of its projection, whose type is never decoded there.
      projections.push(Object.freeze({ key: "value", expression: args[0]!, type: field.type }))
    }
    const rows = deriveOrderedSource(
      {
        kind: "select",
        from: node.from,
        joins: noJoins,
        projections,
        filters,
        orderBy: counted ? noOrder : orderBy,
        limit: node.limit,
        offset: node.offset,
        rows: "many",
        value: false,
        guaranteedBy: undefined,
      },
      field.ordered,
    )
    from = rows.source
    filters = noFilters
    if (!counted) {
      // The arguments after the first are parameters that do not depend on the row, so they stay in the call.
      const sourceArgs: ExpressionNode[] = [
        createNode({ kind: "column", source: from, key: "value" }),
      ]
      for (let index = 1; index < args.length; index++) {
        sourceArgs.push(args[index]!)
      }
      args = sourceArgs
    }
    order = rows.order
  }
  const call: AggregateNode =
    args === aggregate.arguments && order.length === 0
      ? aggregate
      : createNode({
          kind: "aggregate",
          name: aggregate.name,
          distinct: aggregate.distinct,
          arguments: args,
          orderBy: order,
        })
  const fallbacks = lowerEach(field.fallbacks, context, lowerExpression)
  let value: ExpressionNode = call
  if (fallbacks.length > 0) {
    const values: ExpressionNode[] = [call]
    for (const fallback of fallbacks) {
      values.push(fallback)
    }
    value = createList("coalesce(", values, ")")
  }
  return Object.freeze({
    kind: "select",
    from,
    joins: noJoins,
    projections: [
      value === aggregate
        ? field
        : Object.freeze({ key: field.key, expression: value, type: field.type }),
    ],
    filters,
    orderBy: noOrder,
    limit: undefined,
    offset: undefined,
    rows: node.rows,
    value: true,
    guaranteedBy: undefined,
  })
}

/**
 * Tells whether `node` refers to `source` outside the queries nested in it.
 *
 * A reference inside a nested query is not counted, so an argument that refers to the source only there is read from a derived source, which is correct either way.
 */
function refersToSource(node: ExpressionNode, source: SourceNode): boolean {
  switch (node.kind) {
    case "column":
      return node.source === source
    case "param":
    case "boolean":
    case "values":
    case "nestedQuery":
    case "tableName":
    case "subquery":
    case "exists":
      return false
    case "cast":
    case "not":
    case "isNull":
    case "inQuery":
      return refersToSource(node.operand, source)
    case "and":
    case "or":
      return node.operands.some(operand => refersToSource(operand, source))
    case "comparison":
      return refersToSource(node.left, source) || refersToSource(node.right, source)
    case "in":
      return (
        refersToSource(node.operand, source) || node.list.some(item => refersToSource(item, source))
      )
    case "raw":
      return node.values.some(value => refersToSource(value, source))
    case "aggregate":
      return node.arguments.some(argument => refersToSource(argument, source))
    default:
      return node satisfies never
  }
}

// Whether a row exists depends on neither the selected fields, including nested queries, nor the order, even of the rows of a page, so the query of `EXISTS` has neither.
/** Lowers a query of `exists` to `EXISTS` of the rows that its filters, limit, and offset choose. */
function lowerExists(node: QueryNode, context: LoweringContext): ExistsNode {
  checkRelation(node, context)
  return createNode({
    kind: "exists",
    query: Object.freeze({
      kind: "select",
      from: node.from,
      joins: noJoins,
      projections: noProjections,
      filters: lowerFilters(node.filters, context),
      orderBy: noOrder,
      limit: node.limit,
      offset: node.offset,
      rows: "many",
      value: false,
      guaranteedBy: undefined,
    }),
  })
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

/** Creates the projection of `EXISTS` of the rows of `node`, a query of `exists`, under `key`, decoded by the type of the projection of `exists`. */
function projectExists(key: string, node: QueryNode, context: LoweringContext): ProjectionNode {
  return Object.freeze({
    key,
    expression: lowerExists(node, context),
    type: (node.projections[0] as ScalarProjection).type,
  })
}

/** Lowers a query of `$select` to a statement without a source, which returns one row of its fields. */
function lowerRecord(node: RecordQueryNode, context: LoweringContext): SelectNode<undefined> {
  return Object.freeze({
    kind: "select",
    from: undefined,
    joins: noJoins,
    projections: lowerProjections(node.projections, context),
    filters: noFilters,
    orderBy: noOrder,
    limit: undefined,
    offset: undefined,
    rows: "one",
    value: false,
    guaranteedBy: undefined,
  })
}

/**
 * Lowers the fields of a query to projections, packing the rows of each nested query into the value of its field, or selecting the value of an aggregate query or `EXISTS` of a query of `exists`, and replacing the queries in the expressions of the other fields; checks them as `lowerQuery` does.
 *
 * Without queries, it returns `selected` itself.
 */
function lowerProjections(
  selected: readonly SelectedNode[],
  context: LoweringContext,
): readonly ProjectionNode[] {
  let lowered: ProjectionNode[] | undefined
  for (let index = 0; index < selected.length; index++) {
    const field = selected[index]!
    let projection: ProjectionNode
    if (isNestedSelection(field)) {
      checkDb(field.db, context, `Selected field "${field.key}"`)
      projection = projectQuery(field.key, field.query, context)
    } else {
      const expression = lowerExpression(field.expression, context)
      // Only lowering adds projections of nested rows, so the field is scalar.
      projection =
        expression === field.expression
          ? field
          : Object.freeze({ key: field.key, expression, type: (field as ScalarProjection).type })
    }
    if (lowered !== undefined) {
      lowered.push(projection)
    } else if (projection !== field) {
      lowered = selected.slice(0, index) as ProjectionNode[]
      lowered.push(projection)
    }
  }
  return lowered ?? (selected as readonly ProjectionNode[])
}

/** Creates the projection of the value of `node`, a nested query, under `key`: `EXISTS` of a query of `exists`, the value of an aggregate query, or the packed rows of another query. */
function projectQuery(key: string, node: QueryNode, context: LoweringContext): ProjectionNode {
  if (isExistsQuery(node)) {
    return projectExists(key, node, context)
  }
  const query = lowerSelect(node, context, false)
  return isAggregateQuery(node) ? projectAggregateValue(key, query) : projectRows(key, query)
}

// An aggregate query always returns one row of one value, so its value needs no packing.
/** Creates the projection of the value of `query`, the statement of an aggregate query, under `key`, selected as a scalar subquery and decoded by the type of the aggregate. */
function projectAggregateValue(key: string, query: SelectNode): ProjectionNode {
  return Object.freeze({
    key,
    expression: createNode({ kind: "subquery", query }),
    type: (query.projections[0] as ScalarProjection).type,
  })
}

/** Lowers the filters of a query, replacing the queries in their expressions; without queries, it returns `filters` itself. */
function lowerFilters(filters: QueryFilters, context: LoweringContext): QueryFilters {
  const { relation, scope, user } = filters
  const loweredRelation = relation === undefined ? undefined : lowerExpression(relation, context)
  const loweredScope = scope === undefined ? undefined : lowerExpression(scope, context)
  const loweredUser = user === undefined ? undefined : lowerExpression(user, context)
  if (loweredRelation === relation && loweredScope === scope && loweredUser === user) {
    return filters
  }
  const lowered: { -readonly [K in keyof QueryFilters]: QueryFilters[K] } = {}
  if (loweredRelation !== undefined) {
    lowered.relation = loweredRelation
  }
  if (loweredScope !== undefined) {
    lowered.scope = loweredScope
  }
  if (loweredUser !== undefined) {
    lowered.user = loweredUser
  }
  return Object.freeze(lowered)
}

/**
 * Lowers the sort keys of a query, replacing the queries in their expressions; without queries, it returns `orderBy` itself.
 *
 * A sort key of a field of `selected`, the fields of the query, takes the expression of its projection among `projections`, the lowered fields, so that the statement still finds the projection that has its value.
 */
function lowerOrder(
  orderBy: readonly OrderNode[],
  context: LoweringContext,
  selected?: readonly SelectedNode[],
  projections?: readonly ProjectionNode[],
): readonly OrderNode[] {
  let lowered: OrderNode[] | undefined
  for (let index = 0; index < orderBy.length; index++) {
    const order = orderBy[index]!
    const { expression } = order
    // Fields are lowered apart from the order, so a field whose expression lowering replaces has a new node.
    const position =
      selected === undefined || projections === undefined || projections === selected
        ? -1
        : selected.findIndex(field => !isNestedSelection(field) && field.expression === expression)
    const sorted =
      position === -1 ? lowerExpression(expression, context) : projections![position]!.expression
    if (lowered === undefined && sorted === expression) {
      continue
    }
    lowered ??= orderBy.slice(0, index)
    lowered.push(
      sorted === expression
        ? order
        : Object.freeze({ expression: sorted, direction: order.direction, nulls: order.nulls }),
    )
  }
  return lowered ?? orderBy
}

/**
 * Lowers an expression, replacing each query in it and checking the query as a nested query.
 * A query of `exists`, such as in a condition, becomes `EXISTS` of its rows, another query of one value a scalar subquery of its value, and the query of the values of `IN` its statement.
 *
 * It returns `node` itself when it holds no query, and creates only the nodes that hold one.
 */
function lowerExpression(node: ExpressionNode, context: LoweringContext): ExpressionNode {
  switch (node.kind) {
    case "column":
    case "param":
    case "boolean":
    case "values":
    case "tableName":
    // Only lowering creates the queries of a scalar subquery and of `EXISTS`, which are lowered already.
    case "subquery":
    case "exists":
      return node
    case "nestedQuery":
      return lowerNestedQuery(node, context)
    case "cast": {
      const operand = lowerExpression(node.operand, context)
      return operand === node.operand
        ? node
        : createNode({ kind: "cast", operand, type: node.type })
    }
    case "not": {
      const operand = lowerExpression(node.operand, context)
      return operand === node.operand ? node : createNode({ kind: "not", operand })
    }
    case "isNull": {
      const operand = lowerExpression(node.operand, context)
      return operand === node.operand ? node : createNode({ kind: "isNull", operand })
    }
    case "and":
    case "or": {
      const operands = lowerEach(node.operands, context, lowerExpression)
      return operands === node.operands ? node : createNode({ kind: node.kind, operands })
    }
    case "comparison": {
      const left = lowerExpression(node.left, context)
      const right = lowerExpression(node.right, context)
      return left === node.left && right === node.right
        ? node
        : createNode({ kind: "comparison", operator: node.operator, left, right })
    }
    case "in": {
      const operand = lowerExpression(node.operand, context)
      const list = lowerEach(node.list, context, lowerExpression)
      return operand === node.operand && list === node.list
        ? node
        : createNode({ kind: "in", operand, list })
    }
    case "inQuery": {
      const operand = lowerExpression(node.operand, context)
      const query =
        node.query.kind === "nestedQuery" ? lowerQueryOfValues(node.query, context) : node.query
      return operand === node.operand && query === node.query
        ? node
        : createNode({ kind: "inQuery", operand, query })
    }
    case "raw": {
      const values = lowerEach(node.values, context, lowerExpression)
      return values === node.values
        ? node
        : createNode({ kind: "raw", fragments: node.fragments, values })
    }
    case "aggregate": {
      const args = lowerEach(node.arguments, context, lowerExpression)
      const orderBy = lowerOrder(node.orderBy, context)
      return args === node.arguments && orderBy === node.orderBy
        ? node
        : createNode({
            kind: "aggregate",
            name: node.name,
            distinct: node.distinct,
            arguments: args,
            orderBy,
          })
    }
    default:
      return node satisfies never
  }
}

/** Lowers a query in an expression to `EXISTS` of the rows of a query of `exists`, or to a scalar subquery of the value of another query, which must have one value. */
function lowerNestedQuery(node: NestedQueryNode, context: LoweringContext): ExpressionNode {
  checkDb(node.db, context, "A query in an expression")
  const { query } = node
  if (isExistsQuery(query)) {
    return lowerExists(query, context)
  }
  return createNode({ kind: "subquery", query: lowerSelect(query, context, false) })
}

/** Lowers the query of the values of `IN` to its statement, whatever its rows. */
function lowerQueryOfValues(node: NestedQueryNode, context: LoweringContext): SelectNode {
  checkDb(node.db, context, "A query in an expression")
  return lowerSelect(node.query, context, false)
}

/** Lowers each of `items` with `lower`; when none changes, it returns `items` itself. */
function lowerEach<T>(
  items: readonly T[],
  context: LoweringContext,
  lower: (item: T, context: LoweringContext) => T,
): readonly T[] {
  let lowered: T[] | undefined
  for (let index = 0; index < items.length; index++) {
    const item = items[index]!
    const result = lower(item, context)
    if (lowered !== undefined) {
      lowered.push(result)
    } else if (result !== item) {
      lowered = items.slice(0, index)
      lowered.push(result)
    }
  }
  return lowered ?? items
}
