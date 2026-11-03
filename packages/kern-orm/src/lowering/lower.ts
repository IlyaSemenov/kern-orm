import type {
  AggregateNode,
  ExistsNode,
  ExpressionNode,
  JoinNode,
  MutationStatementNode,
  OrderNode,
  ProjectionNode,
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

/**
 * Lowers a query to the SQL statement that executes it: the select statement of `lowerQuery` that sorts by the positions of the projections that have the values of its sort expressions, the statement without a source of a query of `$select`, the statement of a mutation, or a statement of SQL text as it is.
 *
 * A selected expression repeated in `ORDER BY` would get parameters of its own, and PostgreSQL may evaluate it again.
 * It checks the nested queries of every statement as `lowerQuery` does.
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
  switch (node.kind) {
    case "query":
      return lowerSelect(node, definitions, db, true)
    case "record":
      return lowerRecord(node, definitions, db)
    case "text":
      return node
    default:
      return lowerMutation(node, definitions, db)
  }
}

/** Lowers a mutation to its statement, packing the rows of each nested query of `RETURNING` into the value of its field, or selecting the value of a nested aggregate query, as a select list does. */
function lowerMutation(
  node: MutationNode,
  definitions: ReadonlySet<RelationDefinition> | undefined,
  db: AnyDb | undefined,
): MutationStatementNode {
  const { returning } = node
  const lowered = returning === undefined ? undefined : lowerProjections(returning, definitions, db)
  // Without nested queries, the fields are already projections.
  if (lowered === returning) {
    return node as MutationStatementNode
  }
  const { target, rows, value } = node
  switch (node.kind) {
    case "insert":
      return Object.freeze({
        kind: "insert",
        target,
        columns: node.columns,
        values: node.values,
        returning: lowered,
        rows,
        value,
      })
    case "update":
      return Object.freeze({
        kind: "update",
        target,
        set: node.set,
        filters: node.filters,
        returning: lowered,
        rows,
        value,
      })
    case "delete":
      return Object.freeze({
        kind: "delete",
        target,
        filters: node.filters,
        returning: lowered,
        rows,
        value,
      })
    default:
      return node satisfies never
  }
}

/**
 * Lowers a query to a SQL select statement, packing the rows of each nested query into the value of its field, or selecting the value of a nested aggregate query or `EXISTS` of a nested query of `exists`.
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
  return lowerSelect(node, definitions, db, false)
}

/** Lowers a query as `lowerQuery` does, or as `lowerStatement` does when `positions` is set. */
function lowerSelect(
  node: QueryNode,
  definitions: ReadonlySet<RelationDefinition> | undefined,
  db: AnyDb | undefined,
  positions: boolean,
): SelectNode {
  if (isExistsQuery(node)) {
    return selectExists(node, definitions)
  }
  checkRelation(node, definitions)
  if (isAggregateQuery(node)) {
    return lowerAggregate(node)
  }
  const { relation } = node
  const projections = lowerProjections(node.projections, definitions, db)
  // Without its row, such a query breaks the promise of the relation rather than missing a record it looks up.
  const guaranteedBy =
    node.guaranteed && relation !== undefined
      ? formatRelationName(relation.key, relation.name)
      : undefined
  // PostgreSQL evaluates the select list also for the rows that an offset skips, so the nested queries of a page after an offset read its rows from a derived source.
  const page =
    node.offset !== undefined && projections !== node.projections
      ? lowerPage(node, projections, positions, guaranteedBy)
      : undefined
  if (page !== undefined) {
    return page
  }
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
    guaranteedBy,
  })
}

/** Rejects a query of a relation outside `definitions`. */
function checkRelation(
  node: QueryNode,
  definitions: ReadonlySet<RelationDefinition> | undefined,
): void {
  const { relation } = node
  // A relation is checked by identity, so a relation of the same name and keys declared by another schema is rejected.
  if (relation !== undefined && definitions !== undefined && !definitions.has(relation)) {
    throw new Error(
      `Relation "${formatRelationName(relation.key, relation.name)}" is not part of the schema`,
    )
  }
}

/**
 * Lowers `node` with `projections` to a statement that evaluates its nested queries over the rows of a derived page.
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
      filters: node.filters,
      orderBy: node.orderBy,
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
function lowerAggregate(node: QueryNode): SelectNode<SourceNode> {
  // The only projection of an aggregate query is the projection of the aggregate.
  const field = node.projections[0] as AggregateProjection
  const aggregate = field.expression
  let from: SourceNode = node.from
  let filters = node.filters
  let args = aggregate.arguments
  let order = field.ordered ? node.orderBy : noOrder
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
        filters: node.filters,
        orderBy: counted ? noOrder : node.orderBy,
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
  const { fallbacks } = field
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
    case "tableName":
    case "subquery":
    case "exists":
      return false
    case "cast":
    case "not":
    case "isNull":
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
function lowerExists(
  node: QueryNode,
  definitions: ReadonlySet<RelationDefinition> | undefined,
): ExistsNode {
  checkRelation(node, definitions)
  return createNode({
    kind: "exists",
    query: Object.freeze({
      kind: "select",
      from: node.from,
      joins: noJoins,
      projections: noProjections,
      filters: node.filters,
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
function selectExists(
  node: QueryNode,
  definitions: ReadonlySet<RelationDefinition> | undefined,
): SelectNode<undefined> {
  return Object.freeze({
    kind: "select",
    from: undefined,
    joins: noJoins,
    projections: [projectExists(node.projections[0]!.key, node, definitions)],
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
function projectExists(
  key: string,
  node: QueryNode,
  definitions: ReadonlySet<RelationDefinition> | undefined,
): ProjectionNode {
  return Object.freeze({
    key,
    expression: lowerExists(node, definitions),
    type: (node.projections[0] as ScalarProjection).type,
  })
}

/** Lowers a query of `$select` to a statement without a source, which returns one row of its fields. */
function lowerRecord(
  node: RecordQueryNode,
  definitions: ReadonlySet<RelationDefinition> | undefined,
  db: AnyDb | undefined,
): SelectNode<undefined> {
  return Object.freeze({
    kind: "select",
    from: undefined,
    joins: noJoins,
    projections: lowerProjections(node.projections, definitions, db),
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
 * Lowers the fields of a query to projections, packing the rows of each nested query into the value of its field, or selecting the value of an aggregate query or `EXISTS` of a query of `exists`; checks them as `lowerQuery` does.
 *
 * Without nested queries, it returns `selected` itself.
 */
function lowerProjections(
  selected: readonly SelectedNode[],
  definitions: ReadonlySet<RelationDefinition> | undefined,
  db: AnyDb | undefined,
): readonly ProjectionNode[] {
  let lowered: ProjectionNode[] | undefined
  for (let index = 0; index < selected.length; index++) {
    const field = selected[index]!
    if (isNestedSelection(field)) {
      // The statement runs with the options of its Db, such as its PostgreSQL schema, so a nested query bound to a Db runs only in a statement of that Db.
      if (field.db !== undefined && field.db !== db) {
        throw new Error(
          db === undefined
            ? `Selected field "${field.key}" is bound to a Db, so only that Db can compile the query`
            : `Selected field "${field.key}" is bound to another Db`,
        )
      }
      lowered ??= selected.slice(0, index) as ProjectionNode[]
      lowered.push(projectQuery(field.key, field.query, definitions, db))
    } else if (lowered !== undefined) {
      lowered.push(field)
    }
  }
  return lowered ?? (selected as readonly ProjectionNode[])
}

/** Creates the projection of the value of `node`, a nested query, under `key`: `EXISTS` of a query of `exists`, the value of an aggregate query, or the packed rows of another query. */
function projectQuery(
  key: string,
  node: QueryNode,
  definitions: ReadonlySet<RelationDefinition> | undefined,
  db: AnyDb | undefined,
): ProjectionNode {
  if (isExistsQuery(node)) {
    return projectExists(key, node, definitions)
  }
  const query = lowerSelect(node, definitions, db, false)
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
