// Sort keys of queries: the arguments of `orderBy`, the functions that give an expression or a query of one value a direction, and the references of its callback to the selected fields.

import type {
  ExpressionNode,
  OrderNode,
  ProjectionNode,
  ScalarProjection,
  TableSourceNode,
} from "../ast/nodes"
import { createNode } from "../ast/nodes"
import type { AnyExpression } from "../expression/expression"
import { isOperandSource, operandNode, toExpression } from "../expression/expression"
import type { ScalarField } from "../result/result"
import type { AnyTable } from "../table/table"
import { requireColumn } from "../table/table"

import { isSelectedAsValue } from "./aggregate"
import type { QueryContext } from "./column-refs"
import { createSelectionRefs } from "./column-refs"
import type { NestedSelectionNode, QueryNode } from "./node"
import { isLiteralSelection, isNestedSelection } from "./node"
import type { ScalarQuery } from "./operand"

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

/** Expression or query of one value with the direction of its sort key, made by `asc`, `desc`, or `orderBy`. */
export interface Ordering {
  readonly [ordering]: true
}

/** Sort key returned by the callback of `orderBy`: an expression or a query of one value, such as of an aggregate of related records, sorted in ascending order, or one with a direction. */
export type OrderTerm = AnyExpression | ScalarQuery | Ordering

// A conditional type of the query state here would keep a query from being assigned to a query of a wider state, such as one that a `Db` executes, so queries of records and of values get their references from overloads of `orderBy`.
/**
 * References of the callbacks of `orderBy`, `groupBy`, and `distinctOn` to the fields of records `R` selected by a query: their expressions by key.
 *
 * A field of nested rows or of a literal is among them in types, but reading it throws; a field of an aggregate or of `exists` gives its value.
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

/** Sorts by `value`, an expression or a query of one value, in ascending order, in the callback of `orderBy`. */
export function asc(value: AnyExpression | ScalarQuery): Ordering {
  return orderBy(value, "asc")
}

/** Sorts by `value`, an expression or a query of one value, in descending order, in the callback of `orderBy`. */
export function desc(value: AnyExpression | ScalarQuery): Ordering {
  return orderBy(value, "desc")
}

/** Sorts by `value`, an expression or a query of one value, in `direction`, such as `"desc nulls last"`, in the callback of `orderBy`. */
export function orderBy(value: AnyExpression | ScalarQuery, direction: OrderDirection): Ordering {
  if (!isOperandSource(value)) {
    throw new TypeError("A sort key must be an expression or a query of one value")
  }
  return new OrderingObject(createOrderNode(value[operandNode](), direction))
}

/**
 * Creates the order of `node` with the sort keys of the arguments of `orderBy` after its own.
 *
 * `args` are column keys and objects of columns with directions, or a callback that receives the columns with the relations of `context` and the selected fields, and returns one sort key or an array of them.
 */
export function addOrder(
  node: QueryNode,
  context: QueryContext,
  args: readonly unknown[],
): OrderNode[] {
  const order = node.orderBy.slice()
  const first = args[0]
  if (typeof first === "function") {
    const terms: unknown = (first as (columns: unknown, selected: unknown) => unknown)(
      createSelectionRefs(node.from, context),
      createSelectedRefs(node, "sorted by"),
    )
    addTerms(order, terms, "The callback of orderBy must return")
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

/** Adds to `order` the sort key nodes of `terms`, `OrderTerms` checked at runtime; `subject` starts the error of another value, such as `The callback of orderBy must return`. */
export function addTerms(order: OrderNode[], terms: unknown, subject: string): void {
  if (Array.isArray(terms)) {
    for (const term of terms) {
      order.push(readTerm(term, subject))
    }
  } else {
    order.push(readTerm(terms, subject))
  }
}

/**
 * Creates the sort key node of a sort key, `OrderTerm` checked at runtime, whose error starts with `subject`.
 *
 * A query is converted by the method of `operandNode`, which rejects a query other than of one value.
 */
function readTerm(term: unknown, subject: string): OrderNode {
  if (term instanceof OrderingObject) {
    return term[orderingNode]
  }
  if (isOperandSource(term)) {
    return createOrderNode(term[operandNode](), "asc")
  }
  throw new TypeError(
    `${subject} expressions, queries of one value, or sort keys of asc, desc, and orderBy`,
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
export function createColumnNode(source: TableSourceNode, key: string): ExpressionNode {
  requireColumn(source.table, key)
  return createNode({ kind: "column", source, key })
}

/**
 * Creates the references of the callback of `orderBy`, `groupBy`, or `distinctOn` to the fields selected by `node`; `purpose` completes the error of a field that cannot be read, such as `sorted by`.
 *
 * Each is an expression over the node of its projection, so that a sort key or a key of a group of it is the projection itself.
 * A field of an aggregate or of `exists` is an expression of its query that holds the field, by which lowering finds the projection of the field.
 */
export function createSelectedRefs(node: QueryNode, purpose: string): unknown {
  const { projections } = node
  if (node.value) {
    // `get`, `pluck`, and the aggregate methods select one expression.
    return toSelectedExpression(projections[0] as ProjectionNode)
  }
  const refs: Record<string, unknown> = {}
  for (const projection of projections) {
    const { key } = projection
    if (isLiteralSelection(projection)) {
      // PostgreSQL does not see a literal, and every row has the same value of it.
      Object.defineProperty(refs, key, {
        get() {
          throw new Error(`Field "${key}" holds a literal and cannot be ${purpose}`)
        },
        enumerable: true,
      })
    } else if (isNestedSelection(projection)) {
      if (isSelectedAsValue(projection.query)) {
        refs[key] = toQueryExpression(projection)
      } else {
        // Nested rows are JSON, which PostgreSQL can neither sort nor group by.
        Object.defineProperty(refs, key, {
          get() {
            throw new Error(`Field "${key}" holds nested rows and cannot be ${purpose}`)
          },
          enumerable: true,
        })
      }
    } else {
      refs[key] = toSelectedExpression(projection)
    }
  }
  return refs
}

/** Creates an expression over the node of a projection of a query, which has a type: only lowering adds projections of nested queries. */
function toSelectedExpression(projection: ProjectionNode): AnyExpression {
  return toExpression(projection.expression, (projection as ScalarField).type)
}

// Only lowering creates the scalar subquery of an aggregate and `EXISTS` of a query, so the expression holds the field, by which lowering finds its projection.
// The field rather than its query: each projection of a query is a subquery of its own, which PostgreSQL evaluates apart, such as one of `random()`.
/** Creates an expression of the value of `field`, a selected aggregate query or query of `exists`, with the type of its value. */
function toQueryExpression(field: NestedSelectionNode): AnyExpression {
  const { query } = field
  return toExpression(
    createNode({ kind: "nestedQuery", query, db: field.db, field }),
    (query.projections[0] as ScalarProjection).type,
  )
}
