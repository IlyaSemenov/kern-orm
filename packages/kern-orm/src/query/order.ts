// Sort keys of queries: the arguments of `orderBy`, the functions that give an expression a direction, and the references of its callback to the selected fields.

import type { ExpressionNode, OrderNode, ProjectionNode, TableSourceNode } from "../ast/nodes"
import { createNode } from "../ast/nodes"
import type { AnyExpression } from "../expression/expression"
import { isExpression, toExpression, toNode } from "../expression/expression"
import type { ScalarField } from "../result/result"
import type { AnyTable } from "../table/table"
import { requireColumn } from "../table/table"

import { createColumnRefs } from "./column-refs"
import type { QueryNode } from "./node"
import { isNestedSelection } from "./node"

/**
 * Direction of a sort key, optionally with the placement of `NULL`.
 *
 * Without a placement, `NULL` comes last in ascending order and first in descending order.
 */
export type OrderDirection =
  | "asc"
  | "desc"
  | "asc nulls first"
  | "asc nulls last"
  | "desc nulls first"
  | "desc nulls last"

/** Columns of table `T` with the directions to sort by them, in the order of their keys. */
export type OrderColumns<T extends AnyTable> = {
  readonly [K in keyof T["columns"]]?: OrderDirection
}

/** Argument of `orderBy` of a query over table `T`: a column key, sorted in ascending order, or columns with directions. */
export type OrderKey<T extends AnyTable> = (keyof T["columns"] & string) | OrderColumns<T>

declare const ordering: unique symbol

/** Expression with the direction of its sort key, made by `asc`, `desc`, or `orderBy`. */
export interface Ordering {
  readonly [ordering]: true
}

/** Sort key returned by the callback of `orderBy`: an expression, sorted in ascending order, or an expression with a direction. */
export type OrderTerm = AnyExpression | Ordering

// A conditional type of the query state here would keep a query from being assigned to a query of a wider state, such as one that a `Db` executes, so queries of records and of values get their references from overloads of `orderBy`.
/**
 * References of the callback of `orderBy` to the fields of records `R` selected by a query: their expressions by key.
 *
 * A field of nested rows is among them in types, but reading it throws.
 */
export type SelectedRefs<R> = { readonly [K in keyof R & string]: AnyExpression<R[K]> }

/** Sort keys returned by the callback of `orderBy`: one or an array of them. */
export type OrderTerms = OrderTerm | readonly OrderTerm[]

/** Direction and placement of `NULL` of a sort key node, by `OrderDirection`. */
const directions: Readonly<Record<string, Omit<OrderNode, "expression">>> =
  /* @__PURE__ */ Object.freeze({
    asc: { direction: "asc", nulls: undefined },
    desc: { direction: "desc", nulls: undefined },
    "asc nulls first": { direction: "asc", nulls: "first" },
    "asc nulls last": { direction: "asc", nulls: "last" },
    "desc nulls first": { direction: "desc", nulls: "first" },
    "desc nulls last": { direction: "desc", nulls: "last" },
  })

// The node lives under a symbol key, as the internals of an expression do.
const orderingNode = Symbol("kern-orm.ordering.node")

/** Runtime class of an expression with a direction, which holds its sort key node. */
class OrderingObject implements Ordering {
  declare readonly [ordering]: true
  readonly [orderingNode]: OrderNode

  constructor(node: OrderNode) {
    this[orderingNode] = node
    Object.freeze(this)
  }
}

/** Sorts by `expression` in ascending order, in the callback of `orderBy`. */
export function asc(expression: AnyExpression): Ordering {
  return orderBy(expression, "asc")
}

/** Sorts by `expression` in descending order, in the callback of `orderBy`. */
export function desc(expression: AnyExpression): Ordering {
  return orderBy(expression, "desc")
}

/** Sorts by `expression` in `direction`, such as `"desc nulls last"`, in the callback of `orderBy`. */
export function orderBy(expression: AnyExpression, direction: OrderDirection): Ordering {
  if (!isExpression(expression)) {
    throw new TypeError("A sort key must be an expression")
  }
  return new OrderingObject(createOrderNode(toNode(expression), direction))
}

/**
 * Creates the order of `node` with the sort keys of the arguments of `orderBy` after its own.
 *
 * `args` are column keys and objects of columns with directions, or a callback that receives the columns and the selected fields and returns one sort key or an array of them.
 */
export function addOrder(node: QueryNode, args: readonly unknown[]): OrderNode[] {
  const order = node.orderBy.slice()
  const first = args[0]
  if (typeof first === "function") {
    const terms: unknown = (first as (columns: unknown, selected: unknown) => unknown)(
      createColumnRefs(node.from),
      createSelectedRefs(node),
    )
    if (Array.isArray(terms)) {
      for (const term of terms) {
        order.push(readTerm(term))
      }
    } else {
      order.push(readTerm(terms))
    }
    return order
  }
  for (const arg of args) {
    if (typeof arg === "string") {
      order.push(createOrderNode(createColumnNode(node.from, arg), "asc"))
    } else if (typeof arg === "object" && arg !== null && !Array.isArray(arg)) {
      const columns = arg as Readonly<Record<string, unknown>>
      for (const key of Object.keys(columns)) {
        order.push(createOrderNode(createColumnNode(node.from, key), columns[key]))
      }
    } else {
      throw new TypeError(
        "orderBy takes column keys and objects of columns with directions, or a callback",
      )
    }
  }
  return order
}

/** Creates the sort key node of a sort key returned by the callback of `orderBy`. */
function readTerm(term: unknown): OrderNode {
  if (term instanceof OrderingObject) {
    return term[orderingNode]
  }
  if (isExpression(term)) {
    return createOrderNode(toNode(term), "asc")
  }
  throw new TypeError(
    "The callback of orderBy must return expressions, or sort keys of asc, desc, and orderBy",
  )
}

/** Creates the sort key node of `expression` in `direction`, an `OrderDirection` checked at runtime. */
function createOrderNode(expression: ExpressionNode, direction: unknown): OrderNode {
  const placement =
    typeof direction === "string" && Object.hasOwn(directions, direction)
      ? directions[direction]!
      : undefined
  if (placement === undefined) {
    throw new TypeError(`Unknown sort direction ${JSON.stringify(direction)}`)
  }
  return Object.freeze({ expression, direction: placement.direction, nulls: placement.nulls })
}

/** Creates a reference to the column `key` of the table of `source`. */
function createColumnNode(source: TableSourceNode, key: string): ExpressionNode {
  requireColumn(source.table, key)
  return createNode({ kind: "column", source, key })
}

/**
 * Creates the references of the callback of `orderBy` to the fields selected by `node`.
 *
 * Each is an expression over the node of its projection, so that a sort key of it is the projection itself.
 */
function createSelectedRefs(node: QueryNode): unknown {
  const { projections } = node
  if (node.value) {
    // `get` and `pluck` select one expression.
    return toSelectedExpression(projections[0] as ProjectionNode)
  }
  const refs: Record<string, unknown> = {}
  for (const projection of projections) {
    const { key } = projection
    if (isNestedSelection(projection)) {
      // Nested rows are JSON, which PostgreSQL cannot sort by.
      Object.defineProperty(refs, key, {
        get() {
          throw new Error(`Field "${key}" holds nested rows and cannot be sorted by`)
        },
        enumerable: true,
      })
    } else {
      refs[key] = toSelectedExpression(projection)
    }
  }
  return refs
}

/** Creates an expression over the node of a projection of a query, which has a type: only lowering adds projections of nested rows. */
function toSelectedExpression(projection: ProjectionNode): AnyExpression {
  return toExpression(projection.expression, (projection as ScalarField).type)
}
