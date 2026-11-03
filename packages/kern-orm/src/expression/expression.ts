import type { ExpressionNode } from "../ast/nodes"
import { createNode } from "../ast/nodes"
import { getBooleanType } from "../type/boolean"
import type { AnyType } from "../type/type"

import type { BoundOperators, OperatorDefinitions } from "./operators/definitions"
import type { EqualityOperators } from "./operators/equality"
import { equalityOperators } from "./operators/equality"

declare const valueType: unique symbol
declare const inputType: unique symbol
declare const typed: unique symbol

// Symbol keys keep the internals of an expression apart from the operators of its type, whatever their names.
const expressionNode = Symbol("kern-orm.expression.node")
const expressionType = Symbol("kern-orm.expression.type")

// Queries import the modules of expressions, so `toValueNode` recognizes a query by this method rather than by its class; an expression has the method too, so that recognizing either takes one lookup.
/** Key of the method of an expression and of every class of queries that returns its node as an operand of an expression, or rejects a query that cannot be one. */
export const operandNode = Symbol("kern-orm.operandNode")

/** Expression or query, which converts itself into the node of an operand of an expression, or rejects itself. */
export interface OperandSource {
  [operandNode](): ExpressionNode
}

/** Expression of TypeScript type `T` accepting compared values of type `I`, whatever its operators. */
export interface AnyExpression<T = unknown, I = unknown> {
  readonly [valueType]: T
  readonly [inputType]: I
}

/** Expression of values `T` accepting compared values `I`, with `isNull` and operators `O`, whether or not it has a type. */
type ExpressionWithOperators<T, O extends OperatorDefinitions, I> = AnyExpression<T, I> &
  Omit<BaseOperators, keyof O> &
  BoundOperators<O, T, I>

/**
 * Expression with a type, evaluating to a SQL value of TypeScript type `T`.
 *
 * Compared plain values are of type `I`, which differs from `T` when the type of the expression accepts other values than it returns, such as a `Date` for `timestamptz`.
 * It has `isNull` and the operators `O` of its type, which also decodes its values, so it can be selected.
 * The AST node behind it is internal.
 */
export type Expression<
  T = unknown,
  O extends OperatorDefinitions = EqualityOperators,
  I = T,
> = ExpressionWithOperators<T, O, I> & TypedExpression<T>

/**
 * Expression of TypeScript type `T` without a type, such as a fragment of `sql<T>`, with the operators of `equalityOperators`.
 *
 * Nothing decodes its values to `T`, so it cannot be selected.
 */
export type UntypedExpression<T = unknown> = ExpressionWithOperators<
  T,
  EqualityOperators,
  NoInfer<T>
>

// The mark states that a type exists, so that widening an expression to `AnyExpression`, which may lack a type, loses it.
/** Expression that has a type to decode its values, which `select`, `get`, and `pluck` require. */
export type TypedExpression<T = unknown> = AnyExpression<T> & { readonly [typed]: true }

/** Operators of expressions of every type. */
export interface BaseOperators {
  isNull(): Expression<boolean>
}

/**
 * Runtime class of every expression.
 *
 * An expression inherits the operators of its type from a prototype created once per type.
 */
class ExpressionObject {
  declare readonly [expressionNode]: ExpressionNode
  /** Type of the expression value: it encodes compared values and provides the operators of the type. */
  declare readonly [expressionType]: AnyType | undefined

  isNull() {
    return toBooleanExpression(createIsNullNode(this[expressionNode]))
  }

  /** Returns the node of the expression as an operand of another expression. */
  [operandNode](): ExpressionNode {
    return this[expressionNode]
  }
}

// A TypeScript type does not determine a SQL type, so an expression without a type keeps the operators that SQL `=` gives.
// It is created on first use: the module of `equalityOperators` imports this one, so they do not exist while this module loads.
let untypedPrototype: ExpressionObject | undefined

/** Prototypes of expressions by their types, with the operators of the type as methods. */
const prototypes = new WeakMap<AnyType, ExpressionObject>()

function getPrototype(type: AnyType): ExpressionObject {
  let prototype = prototypes.get(type)
  if (!prototype) {
    prototype = createPrototype(type.operators)
    prototypes.set(type, prototype)
  }
  return prototype
}

function createPrototype(operators: OperatorDefinitions): ExpressionObject {
  const prototype = Object.create(ExpressionObject.prototype) as ExpressionObject
  for (const name of Object.keys(operators)) {
    const operator = operators[name]!
    Object.defineProperty(prototype, name, {
      value: function (this: AnyExpression, ...args: unknown[]) {
        return operator(this, ...args)
      },
    })
  }
  return prototype
}

/** Returns the node behind a public expression. */
export function toNode(expression: AnyExpression): ExpressionNode {
  return (expression as unknown as ExpressionObject)[expressionNode]
}

/** Exposes a node as a public expression of type `T`, with the operators of `type`. */
export function toExpression<T>(node: ExpressionNode, type: AnyType): Expression<T>
/** Exposes a node as a public expression of type `T`, without a type when `type` is missing, which has the operators of `equalityOperators`. */
export function toExpression<T>(node: ExpressionNode, type?: AnyType): AnyExpression<T>
export function toExpression(node: ExpressionNode, type?: AnyType): AnyExpression {
  const expression = Object.create(
    type ? getPrototype(type) : (untypedPrototype ??= createPrototype(equalityOperators)),
  ) as Record<symbol, unknown>
  expression[expressionNode] = node
  expression[expressionType] = type
  return Object.freeze(expression) as unknown as AnyExpression
}

/** Tells whether `value` is an expression. */
export function isExpression(value: unknown): value is AnyExpression {
  return value instanceof ExpressionObject
}

/** Returns the type of an expression, if it has one. */
export function getType(expression: AnyExpression): AnyType | undefined {
  return (expression as unknown as ExpressionObject)[expressionType]
}

/** Exposes a Boolean node with the shared codec and operators. */
export function toBooleanExpression(node: ExpressionNode): Expression<boolean | null> {
  // The runtime type supplies the codec, not expression nullability; result decoding preserves NULL independently.
  return toExpression(node, getBooleanType())
}

/** Tells whether `value` is an expression or a query, which has the method of `operandNode`, whether or not that method takes it as an operand. */
export function isOperandSource(value: unknown): value is OperandSource {
  return typeof value === "object" && value !== null && operandNode in value
}

/**
 * Converts an operand into a node: an expression or a query by the method of `operandNode`, or a plain value, bound as a parameter encoded with `type`.
 *
 * The method of a query takes a query of one value of a table, which lowering replaces with a scalar subquery, or with `EXISTS` for a query of `exists`, and rejects another query, such as of records or of `$query`.
 */
export function toValueNode(value: unknown, type?: AnyType): ExpressionNode {
  // The check of `isOperandSource` is written out, since calling it takes longer on Bun 1.4.4 for every value of a query.
  if (typeof value === "object" && value !== null && operandNode in value) {
    return (value as OperandSource)[operandNode]()
  }
  return createNode({ kind: "param", value, type })
}

/** Creates an `IS NULL` node directly, so that resolving an object condition never calls an `isNull` operator replaced by a type. */
export function createIsNullNode(operand: ExpressionNode): ExpressionNode {
  return createNode({ kind: "isNull", operand })
}
