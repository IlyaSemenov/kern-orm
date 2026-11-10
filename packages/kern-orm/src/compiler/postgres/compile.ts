import { combineFilters } from "../../ast/boolean"
import type {
  AssignmentNode,
  ColumnRefNode,
  ExpressionNode,
  InsertNode,
  MutationStatementNode,
  OrderNode,
  ProjectionNode,
  QueryFilters,
  SelectNode,
  StatementNode,
  TableNameNode,
  TableSourceNode,
} from "../../ast/nodes"
import { findValueProjection } from "../../ast/projections"
import type { SqlStatement } from "../../database/driver"
import { quoteIdentifier } from "../../database/identifier"
import { renderFragment } from "../../database/sql/fragment"
import { encodeParameter } from "../../database/sql/parameter"
import type { AnyDb } from "../../execution/db"
import type { StatementPlan } from "../../result/result"
import type { AnyTable } from "../../table/table"
import { requireColumn } from "../../table/table"

import { CompileContext } from "./context"
import { nameProjection } from "./identifier"
import type { OperandPosition } from "./parentheses"
import { needsParentheses } from "./parentheses"
import type { Scope } from "./scope"
import { declareSource, resolveSource } from "./scope"

/** Physical placement of the tables of a query, fixed at compilation. */
export interface CompileOptions {
  /** PostgreSQL schema qualifying every table; tables stay unqualified when it is not set. */
  schemaName?: string
}

/** Compiled statement with the result plan that decodes its result. */
export interface CompiledQuery extends SqlStatement, StatementPlan {
  /** Whether a select statement locks rows at any depth, so that it is of use only in a transaction, which holds the locks after it. */
  readonly locksRows: boolean
}

const noFields: readonly ProjectionNode[] = /* @__PURE__ */ Object.freeze([])

/**
 * Compiles a statement for PostgreSQL: a select statement, a mutation, or a statement of SQL text.
 *
 * With `tables`, such as the tables of the schema of a `Db`, an occurrence or an interpolated name of any other table at any depth of the statement is rejected.
 * `db` is the `Db` that runs the statement: a table interpolated from a query bound to another `Db`, or to any `Db` without it, is rejected.
 */
export function compileStatement(
  node: StatementNode,
  options: CompileOptions = {},
  tables?: ReadonlySet<AnyTable>,
  db?: AnyDb,
): CompiledQuery {
  const context = new CompileContext(options.schemaName, tables, db)
  switch (node.kind) {
    case "select":
      return {
        text: compileQuery(context, undefined, node),
        parameters: context.parameters,
        // A projection is a result field, so the result needs no copy of the projections.
        fields: node.projections,
        recordTemplate: node.recordTemplate,
        conversion: node.conversion,
        rows: node.rows,
        value: node.value,
        counted: undefined,
        named: false,
        // The fields above compile the statement first, which finds its locks.
        locksRows: context.locksRows,
      }
    case "text": {
      const { fields } = node
      return {
        text: compileExpression(context, undefined, node.sql),
        parameters: context.parameters,
        fields: fields ?? noFields,
        rows: node.rows,
        value: node.value,
        counted: fields === undefined ? "number" : undefined,
        named: true,
        // kern-orm does not read the text, which may change rows under its locks.
        locksRows: false,
      }
    }
    default: {
      const { returning } = node
      return {
        text: compileMutation(context, node),
        parameters: context.parameters,
        fields: returning ?? noFields,
        recordTemplate: node.recordTemplate,
        conversion: node.conversion,
        rows: node.rows,
        value: node.value,
        // PostgreSQL rejects `RETURNING` without fields, so a mutation that returns records without fields counts them.
        counted:
          returning === undefined ? "number" : returning.length === 0 ? "records" : undefined,
        named: false,
        // A lock in a query of its values or filters holds the row for the change of the statement.
        locksRows: false,
      }
    }
  }
}

/** Compiles a mutation, whose expressions see the occurrence of its table, apart from the values of an insert, which see no source, and the values of `DO UPDATE SET`, which also see the row proposed for insertion as `excluded`. */
function compileMutation(context: CompileContext, node: MutationStatementNode): string {
  // PostgreSQL finds `excluded` of `DO UPDATE` ambiguous beside a source of that alias, even the table of the insert, so the statement takes the alias before any source.
  if (node.kind === "insert" && node.conflict?.update !== undefined) {
    context.createAlias(excludedAlias)
  }
  const scope = declareSource(context, undefined, node.target)
  const target = compileSource(context, undefined, scope)
  let text: string
  switch (node.kind) {
    case "insert":
      text = `INSERT INTO ${target}${compileValues(context, node)}${compileConflict(context, scope, node)}`
      break
    case "update": {
      text = `UPDATE ${target} SET${compileAssignments(context, scope, node.target, node.set)}`
      text += compileWhere(context, scope, node.filters)
      break
    }
    case "delete":
      text = `DELETE FROM ${target}${compileWhere(context, scope, node.filters)}`
      break
    default:
      return node satisfies never
  }
  const { returning } = node
  if (returning !== undefined && returning.length > 0) {
    text += ` RETURNING${compileProjections(context, scope, returning)}`
  }
  return text
}

/** Compiles the columns and the rows of `VALUES` of an insert, or `DEFAULT VALUES` for one row of the defaults of every column. */
function compileValues(context: CompileContext, node: InsertNode): string {
  const { columns, values } = node
  if (columns.length === 0) {
    if (values.length !== 1) {
      throw new Error("An insert of several rows must list a column")
    }
    return " DEFAULT VALUES"
  }
  let text = " ("
  for (let index = 0; index < columns.length; index++) {
    text += `${index === 0 ? "" : ", "}${compileColumnName(node.target, columns[index]!)}`
  }
  text += ") VALUES"
  for (let row = 0; row < values.length; row++) {
    const items = values[row]!
    text += row === 0 ? " (" : ", ("
    for (let index = 0; index < items.length; index++) {
      const item = items[index]
      // An insert sees no source, so its values refer to none.
      text += `${index === 0 ? "" : ", "}${item === undefined ? "DEFAULT" : compileExpression(context, undefined, item)}`
    }
    text += ")"
  }
  return text
}

/** Alias of the row proposed for insertion in `DO UPDATE` of `ON CONFLICT`, which PostgreSQL names `EXCLUDED`. */
const excludedAlias = "excluded"

/**
 * Compiles `ON CONFLICT` of an insert, which names the physical columns of its key, or the expression `(true)` of the unique index of a singleton table, or nothing for an insert without it.
 *
 * The values of `DO UPDATE SET` see the existing row in `scope`, the occurrence of the table of the insert, and the row proposed for insertion as `excluded`.
 */
function compileConflict(context: CompileContext, scope: Scope, node: InsertNode): string {
  const { conflict } = node
  if (conflict === undefined) {
    return ""
  }
  const { target, update } = conflict
  let text = " ON CONFLICT"
  // PostgreSQL infers the unique index of the expression `(true)`, whatever its name, as it infers the index of the columns of a key.
  if (target === "singleton") {
    text += " ((true))"
  } else {
    for (let index = 0; index < target.length; index++) {
      text += `${index === 0 ? " (" : ", "}${compileColumnName(node.target, target[index]!)}`
    }
    if (target.length > 0) {
      text += ")"
    }
  }
  if (update === undefined) {
    return `${text} DO NOTHING`
  }
  // `compileMutation` took the alias before any source, so no source of the statement takes it.
  const excluded: Scope = { source: update.excluded, alias: excludedAlias, outer: scope }
  return `${text} DO UPDATE SET${compileAssignments(context, excluded, node.target, update.set)}`
}

/** Compiles the assignments of `SET` of an update or of `DO UPDATE` to the columns of the table of `target`, whose values see the sources of `scope`. */
function compileAssignments(
  context: CompileContext,
  scope: Scope,
  target: TableSourceNode,
  set: readonly AssignmentNode[],
): string {
  let text = ""
  for (let index = 0; index < set.length; index++) {
    const { key, value } = set[index]!
    text += `${index === 0 ? " " : ", "}${compileColumnName(target, key)} = ${compileExpression(context, scope, value)}`
  }
  return text
}

/** Compiles the physical name of the column of the table of `target` under `key`, as `SET`, the column list of an insert, and the target of `ON CONFLICT` name it, without an alias. */
function compileColumnName(target: TableSourceNode, key: string): string {
  return quoteIdentifier(requireColumn(target.table, key).attributes.name ?? key)
}

/** Compiles a query at a position of the statement where the sources of `outer` are visible. */
function compileQuery(context: CompileContext, outer: Scope | undefined, node: SelectNode): string {
  const { from } = node
  if (from === undefined && node.joins.length > 0) {
    throw new Error("A query without FROM cannot join sources")
  }
  // The select list sees the sources but precedes them in the text: they are declared first and compiled after it, so that parameters are numbered in the order of the text.
  // A query without a source sees only the sources of enclosing queries.
  const fromScope = from === undefined ? undefined : declareSource(context, outer, from)
  let scope = fromScope ?? outer
  const joinScopes: Scope[] = []
  for (const join of node.joins) {
    scope = declareSource(context, scope, join.source)
    joinScopes.push(scope)
  }

  const { groupBy, having } = node
  const { grouped } = context
  // PostgreSQL matches an expression with the keys of `GROUP BY` only in the query of groups itself, not in the queries nested in it.
  context.grouped = groupBy !== undefined
  // PostgreSQL accepts an empty select list and returns rows without columns, unless the query is distinct.
  let text = "SELECT"
  if (node.distinct) {
    text += " DISTINCT"
  }
  const { distinctOn } = node
  if (distinctOn !== undefined) {
    // The keys precede the select list in the text, so they are compiled first, which numbers their parameters in the order of the text.
    text += ` DISTINCT ON (${compileKeys(context, scope, distinctOn, node.projections)})`
  }
  text += compileProjections(context, scope, node.projections)

  if (fromScope !== undefined) {
    text += ` FROM ${compileSource(context, outer, fromScope)}`
    for (let index = 0; index < node.joins.length; index++) {
      const joinScope = joinScopes[index]!
      text += ` LEFT JOIN ${compileSource(context, outer, joinScope)} ON ${compileExpression(context, joinScope, node.joins[index]!.on)}`
    }
  }

  text += compileWhere(context, scope, node.filters)

  if (groupBy !== undefined) {
    text += ` GROUP BY ${compileKeys(context, scope, groupBy, node.projections)}`
  }
  if (having !== undefined) {
    text += ` HAVING ${compileExpression(context, scope, having)}`
  }

  if (node.orderBy.length > 0) {
    text += ` ${compileOrderBy(context, scope, node.orderBy)}`
  }

  if (node.limit) {
    text += ` LIMIT ${compileExpression(context, outer, node.limit)}`
  }
  if (node.offset) {
    text += ` OFFSET ${compileExpression(context, outer, node.offset)}`
  }
  const { lock } = node
  if (lock !== undefined) {
    context.locksRows = true
    text += ` FOR ${lock.strength}`
    if (lock.onLocked !== undefined) {
      text += ` ${lock.onLocked}`
    }
  }
  context.grouped = grouped
  return text
}

/** Compiles the projections of a select list or of `RETURNING`, each after a space or a comma. */
function compileProjections(
  context: CompileContext,
  scope: Scope | undefined,
  projections: readonly ProjectionNode[],
): string {
  let text = ""
  for (let index = 0; index < projections.length; index++) {
    const projection = projections[index]!
    // Rows are decoded by position, so the SQL name of a projection matters only to references through a derived source, which name it the same way.
    text += `${index === 0 ? " " : ", "}${compileExpression(context, scope, projection.expression)} AS ${quoteIdentifier(nameProjection(projection.key, index))}`
  }
  return text
}

/** Compiles the `WHERE` clause of the effective predicate of `filters` after a space, or nothing when they restrict no row. */
function compileWhere(
  context: CompileContext,
  scope: Scope | undefined,
  filters: QueryFilters,
): string {
  const where = combineFilters(filters)
  return where.kind === "boolean" && where.value
    ? ""
    : ` WHERE ${compileExpression(context, scope, where)}`
}

// A repeated expression with a correlated subquery or with parameters other than of casts would not be the key for PostgreSQL, since it has aliases and parameters of its own, so a key refers to its projection by position.
/** Compiles the keys of `GROUP BY` or `DISTINCT ON` of a query of `projections`, its final select list, also with those that lowering adds, such as of a sort key of packed rows: each key is the position of the projection that has its value, or its expression without one. */
function compileKeys(
  context: CompileContext,
  scope: Scope | undefined,
  keys: readonly ExpressionNode[],
  projections: readonly ProjectionNode[],
): string {
  let text = ""
  for (let index = 0; index < keys.length; index++) {
    const key = keys[index]!
    const position = findValueProjection(projections, key)
    text += `${index === 0 ? "" : ", "}${position === -1 ? compileExpression(context, scope, key) : String(position + 1)}`
  }
  return text
}

/** Compiles the `ORDER BY` clause of a query or an aggregate, which has at least one sort key. */
function compileOrderBy(
  context: CompileContext,
  scope: Scope | undefined,
  orderBy: readonly OrderNode[],
): string {
  let text = "ORDER BY"
  for (let index = 0; index < orderBy.length; index++) {
    const order = orderBy[index]!
    text += `${index === 0 ? " " : ", "}${compileExpression(context, scope, order.expression)}`
    if (order.direction === "desc") {
      text += " DESC"
    }
    if (order.nulls !== undefined) {
      text += order.nulls === "first" ? " NULLS FIRST" : " NULLS LAST"
    }
  }
  return text
}

/** Compiles a declared source of a query at a position of the statement where the sources of `outer` are visible. */
function compileSource(context: CompileContext, outer: Scope | undefined, declared: Scope): string {
  const { source, alias } = declared
  if (source.kind === "table") {
    // Every occurrence of a table, including in nested queries and joins, is compiled here.
    return `${compileTableName(context, source.table)} AS ${quoteIdentifier(alias)}`
  }
  // A plain derived source does not see the sources before it in the same FROM, only those of enclosing queries.
  const query = compileQuery(context, source.lateral ? declared.outer : outer, source.query)
  return `${source.lateral ? "LATERAL " : ""}(${query}) AS ${quoteIdentifier(alias)}`
}

/** Compiles the name of `table`, qualified by the PostgreSQL schema of the statement, rejecting a table outside the tables of the statement. */
function compileTableName(context: CompileContext, table: AnyTable): string {
  if (context.tables !== undefined && !context.tables.has(table)) {
    throw new Error(`Table "${table.name}" is not part of the schema`)
  }
  return context.schemaName === undefined
    ? quoteIdentifier(table.name)
    : `${quoteIdentifier(context.schemaName)}.${quoteIdentifier(table.name)}`
}

// The statement runs with the options of its Db, such as its PostgreSQL schema, so a table interpolated from a query bound to a Db is named only in a statement of that Db.
/** Compiles the name of a table interpolated into a SQL fragment, rejecting a table of a query bound to a `Db` other than the one that runs the statement. */
function compileInterpolatedTable(context: CompileContext, node: TableNameNode): string {
  const { db, table } = node
  if (db !== undefined && db !== context.db) {
    throw new Error(
      context.db === undefined
        ? `Table "${table.name}" interpolated into SQL is bound to a Db, so only that Db can compile the query`
        : `Table "${table.name}" interpolated into SQL is bound to another Db`,
    )
  }
  return compileTableName(context, table)
}

function compileColumn(scope: Scope | undefined, node: ColumnRefNode): string {
  const { key } = node
  const declared = resolveSource(scope, node)
  // A derived source that replaces the table of a reference has the column under the key of its projection.
  const { source } = declared
  let name: string
  if (source.kind === "table") {
    name = requireColumn(source.table, key).attributes.name ?? key
  } else {
    const index = source.query.projections.findIndex(projection => projection.key === key)
    if (index === -1) {
      throw new Error(`Unknown field "${key}" of a subquery`)
    }
    name = nameProjection(key, index)
  }
  return `${quoteIdentifier(declared.alias)}.${quoteIdentifier(name)}`
}

function compileExpression(
  context: CompileContext,
  scope: Scope | undefined,
  node: ExpressionNode,
): string {
  switch (node.kind) {
    case "column":
      return compileColumn(scope, node)
    case "param":
      return context.bind(encodeParameter(node.value, node.type))
    case "cast": {
      const { operand } = node
      const value =
        operand.kind === "param"
          ? context.bindParam(node, encodeParameter(operand.value, operand.type))
          : compileOperand(context, scope, operand, "value")
      return `${value}::${node.type.castType}`
    }
    case "boolean":
      return node.value ? "TRUE" : "FALSE"
    case "and":
    case "or":
      return node.operands
        .map(operand => compileOperand(context, scope, operand, "condition"))
        .join(node.kind === "and" ? " AND " : " OR ")
    case "not":
      return `NOT ${compileOperand(context, scope, node.operand, "condition")}`
    case "values":
      throw new Error("An object condition can only be used in `where`")
    case "nestedQuery":
      throw new Error("A query in an expression must be lowered before compilation")
    case "comparison":
      return `${compileOperand(context, scope, node.left, "value")} ${node.operator} ${compileOperand(context, scope, node.right, "value")}`
    case "in": {
      let text = `${compileOperand(context, scope, node.operand, "value")} IN (${compileOperand(context, scope, node.list[0]!, "value")}`
      for (let index = 1; index < node.list.length; index++) {
        text += `, ${compileOperand(context, scope, node.list[index]!, "value")}`
      }
      return `${text})`
    }
    case "inQuery": {
      const { query } = node
      if (query.kind === "nestedQuery") {
        throw new Error("A query in an expression must be lowered before compilation")
      }
      return `${compileOperand(context, scope, node.operand, "value")} IN ${compileSubquery(context, scope, query, "A subquery of IN")}`
    }
    case "isNull":
      return `${compileOperand(context, scope, node.operand, "value")} IS NULL`
    case "raw": {
      let text = node.fragments[0]!
      for (let index = 0; index < node.values.length; index++) {
        text +=
          compileOperand(context, scope, node.values[index]!, "interpolation") +
          node.fragments[index + 1]!
      }
      return text
    }
    case "fragment":
      return renderFragment(node.fragment, context)
    case "tableName":
      return compileInterpolatedTable(context, node)
    case "subquery":
      return compileSubquery(context, scope, node.query, "A scalar subquery")
    case "exists":
      return `EXISTS (${compileQuery(context, scope, node.query)})`
    case "textSubquery":
      return `(${compileQuery(context, scope, node.query)})`
    case "aggregate": {
      // Arguments precede the order and the order precedes the filter in the text, so their parameters are numbered in this order.
      let text = `${node.name}(${node.distinct ? "DISTINCT " : ""}`
      for (let index = 0; index < node.arguments.length; index++) {
        text += `${index === 0 ? "" : ", "}${compileExpression(context, scope, node.arguments[index]!)}`
      }
      if (node.orderBy.length > 0) {
        text += ` ${compileOrderBy(context, scope, node.orderBy)}`
      }
      text += ")"
      if (node.filter !== undefined) {
        text += ` FILTER (WHERE ${compileExpression(context, scope, node.filter)})`
      }
      return text
    }
    default:
      return node satisfies never
  }
}

/** Compiles `query` in parentheses as a subquery of one field, and rejects a query of another number of fields, naming the subquery as `subject`. */
function compileSubquery(
  context: CompileContext,
  scope: Scope | undefined,
  query: SelectNode,
  subject: string,
): string {
  const { length } = query.projections
  if (length !== 1) {
    throw new Error(`${subject} must select one field, not ${length}`)
  }
  return `(${compileQuery(context, scope, query)})`
}

/** Compiles an operand at `position` of its parent, parenthesizing it where its own operators could regroup with the parent. */
function compileOperand(
  context: CompileContext,
  scope: Scope | undefined,
  node: ExpressionNode,
  position: OperandPosition,
): string {
  const sql = compileExpression(context, scope, node)
  return needsParentheses(node.kind, position) ? `(${sql})` : sql
}
