import { combineNodes } from "../../ast/boolean"
import type {
  ColumnRefNode,
  ExpressionNode,
  OrderNode,
  ParamNode,
  SelectNode,
} from "../../ast/nodes"
import type { SqlStatement } from "../../execution/driver"
import type { ResultPlan } from "../../result/result"
import type { AnyTable } from "../../table/table"
import { requireColumn } from "../../table/table"
import type { TextValue } from "../../type/type"
import { encodeUntyped } from "../../type/untyped"

import { CompileContext } from "./context"
import { nameProjection, quoteIdentifier } from "./identifier"
import type { OperandPosition } from "./parentheses"
import { needsParentheses } from "./parentheses"
import type { Scope } from "./scope"
import { declareSource, resolveAlias } from "./scope"

/** Physical placement of the tables of a query, fixed at compilation. */
export interface CompileOptions {
  /** PostgreSQL schema qualifying every table; tables stay unqualified when it is not set. */
  schemaName?: string
}

/** Compiled statement with the result plan that decodes its rows. */
export interface CompiledQuery extends SqlStatement, ResultPlan {}

/**
 * Compiles a select statement for PostgreSQL.
 *
 * With `tables`, such as the tables of the schema of a `Db`, an occurrence of any other table at any depth of the statement is rejected.
 */
export function compileSelect(
  node: SelectNode,
  options: CompileOptions = {},
  tables?: ReadonlySet<AnyTable>,
): CompiledQuery {
  const context = new CompileContext(options.schemaName, tables)
  return {
    text: compileQuery(context, undefined, node),
    parameters: context.parameters,
    // A projection is a result field, so the result needs no copy of the projections.
    fields: node.projections,
    rows: node.rows,
    value: node.value,
  }
}

/** Compiles a query at a position of the statement where the sources of `outer` are visible. */
function compileQuery(context: CompileContext, outer: Scope | undefined, node: SelectNode): string {
  // The select list sees the sources but precedes them in the text: they are declared first and compiled after it, so that parameters are numbered in the order of the text.
  const fromScope = declareSource(context, outer, node.from)
  let scope = fromScope
  const joinScopes: Scope[] = []
  for (const join of node.joins) {
    scope = declareSource(context, scope, join.source)
    joinScopes.push(scope)
  }

  const { projections } = node
  // PostgreSQL accepts an empty select list and returns rows without columns.
  let text = "SELECT"
  for (let index = 0; index < projections.length; index++) {
    const projection = projections[index]!
    // Rows are decoded by position, so the SQL name of a projection matters only to references through a derived source, which name it the same way.
    text += `${index === 0 ? " " : ", "}${compileExpression(context, scope, projection.expression)} AS ${quoteIdentifier(nameProjection(projection.key, index))}`
  }

  text += ` FROM ${compileSource(context, outer, fromScope)}`
  for (let index = 0; index < node.joins.length; index++) {
    const joinScope = joinScopes[index]!
    text += ` LEFT JOIN ${compileSource(context, outer, joinScope)} ON ${compileExpression(context, joinScope, node.joins[index]!.on)}`
  }

  const { filters } = node
  const where = combineNodes(
    "and",
    [filters.relation, filters.scope, filters.user].filter(filter => filter !== undefined),
  )
  if (!(where.kind === "boolean" && where.value)) {
    text += ` WHERE ${compileExpression(context, scope, where)}`
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
    if (context.tables !== undefined && !context.tables.has(source.table)) {
      throw new Error(`Table "${source.table.name}" is not part of the schema`)
    }
    const tableName =
      context.schemaName === undefined
        ? quoteIdentifier(source.table.name)
        : `${quoteIdentifier(context.schemaName)}.${quoteIdentifier(source.table.name)}`
    return `${tableName} AS ${quoteIdentifier(alias)}`
  }
  // A plain derived source does not see the sources before it in the same FROM, only those of enclosing queries.
  const query = compileQuery(context, source.lateral ? declared.outer : outer, source.query)
  return `${source.lateral ? "LATERAL " : ""}(${query}) AS ${quoteIdentifier(alias)}`
}

function compileColumn(scope: Scope | undefined, node: ColumnRefNode): string {
  const { source, key } = node
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
  return `${quoteIdentifier(resolveAlias(scope, node))}.${quoteIdentifier(name)}`
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
      return context.bind(encodeParameter(node))
    case "cast":
      return `${compileOperand(context, scope, node.operand, "value")}::${node.type.castType}`
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
    case "comparison":
      return `${compileOperand(context, scope, node.left, "value")} ${node.operator} ${compileOperand(context, scope, node.right, "value")}`
    case "in": {
      let text = `${compileOperand(context, scope, node.operand, "value")} IN (${compileOperand(context, scope, node.list[0]!, "value")}`
      for (let index = 1; index < node.list.length; index++) {
        text += `, ${compileOperand(context, scope, node.list[index]!, "value")}`
      }
      return `${text})`
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
    case "subquery": {
      const { length } = node.query.projections
      if (length !== 1) {
        throw new Error(`A scalar subquery must select one field, not ${length}`)
      }
      return `(${compileQuery(context, scope, node.query)})`
    }
    case "exists":
      return `EXISTS (${compileQuery(context, scope, node.query)})`
    case "aggregate": {
      // Arguments precede the order in the text, so their parameters are numbered first.
      let text = `${node.name}(`
      for (let index = 0; index < node.arguments.length; index++) {
        text += `${index === 0 ? "" : ", "}${compileExpression(context, scope, node.arguments[index]!)}`
      }
      if (node.orderBy.length > 0) {
        text += ` ${compileOrderBy(context, scope, node.orderBy)}`
      }
      return `${text})`
    }
    default:
      return node satisfies never
  }
}

/** Encodes the value of a parameter node with its type, or by its JavaScript type without one. */
function encodeParameter(node: ParamNode): TextValue {
  if (node.value === undefined) {
    // An omitted value must not turn into a condition silently, such as `flag = FALSE` for `{ flag: undefined }`.
    throw new TypeError("Query parameter is undefined; use null for NULL")
  }
  if (node.value === null) {
    return null
  }
  return node.type ? node.type.encode(node.value as never) : encodeUntyped(node.value)
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
