import type { ExpressionNode } from "../../ast/nodes"
import { createNode, falseNode } from "../../ast/nodes"
import type { AnyType } from "../../type/type"
import type { Expression } from "../expression"
import { getType, toBooleanExpression, toNode, toValueNode } from "../expression"

import type { BooleanResult, ComparisonSignature, Operand, OperandValue } from "./comparison"
import { compare } from "./comparison"
import type { OperatorDefinitions } from "./definitions"
import type { GenericOperator, GenericOperatorImplementation, OperatorSignature } from "./generic"
import { defineGenericOperator } from "./generic"

/** Runtime mark of the operators of `equalityOperators`, which tell that a type has SQL `=`. */
const equalityBrand = Symbol("kern-orm.equality")

/** Generic operator of `equalityOperators`, which gives the type it is added to SQL `=`. */
export interface EqualityOperator<S extends OperatorSignature> extends GenericOperator<S> {
  readonly [equalityBrand]: true
}

/** Signature of `in`: membership in a list of operands of the expression type; an empty list yields `FALSE`. */
export interface InSignature extends OperatorSignature {
  readonly method: <const L extends readonly Operand<this["T"], this["I"]>[]>(
    list: L,
  ) => Expression<
    L extends readonly [] ? boolean : BooleanResult<this["T"] | OperandValue<L[number]>>
  >
}

/** Operators of `equalityOperators`. */
export type EqualityOperators = {
  eq: EqualityOperator<ComparisonSignature>
  ne: EqualityOperator<ComparisonSignature>
  in: EqualityOperator<InSignature>
}

/** Tells whether operators `O` include an operator of `equalityOperators`, so that their type has SQL `=`. */
export type HasEquality<O> = true extends {
  [K in keyof O]: O[K] extends { readonly [equalityBrand]: true } ? true : false
}[keyof O]
  ? true
  : false

/**
 * Operators of SQL equality: `eq`, `ne`, and `in`; `orderingOperators` include them.
 *
 * A type has SQL `=` only with these operators, so that an array of it has them too; another operator named `eq` does not give it `=`.
 */
export const equalityOperators: EqualityOperators = {
  eq: defineEqualityOperator<ComparisonSignature>((self, value) => compare(self, "=", value)),
  ne: defineEqualityOperator<ComparisonSignature>((self, value) => compare(self, "<>", value)),
  in: defineEqualityOperator<InSignature>((self, list) => {
    if (list.length === 0) {
      return toBooleanExpression(falseNode)
    }
    const type = getType(self)
    const nodes: ExpressionNode[] = []
    for (const item of list) {
      nodes.push(toValueNode(item, type))
    }
    return toBooleanExpression(createNode({ kind: "in", operand: toNode(self), list: nodes }))
  }),
}

/** Tells whether a type has SQL `=`, given by an operator of `equalityOperators`. */
export function hasEquality(type: AnyType): boolean {
  const operators: OperatorDefinitions = type.operators
  for (const name in operators) {
    if (equalityBrand in operators[name]!) {
      return true
    }
  }
  return false
}

/**
 * Families of different SQL types, by their cast types, whose values PostgreSQL compares with `=` of one B-tree operator family, so that an index of either column serves the comparison.
 *
 * `varchar` has no `=` of its own and compares as `text`.
 */
const equalityFamilies: ReadonlyMap<string, string> = /* @__PURE__ */ new Map([
  ["smallint", "integer"],
  ["integer", "integer"],
  ["bigint", "integer"],
  ["text", "text"],
  ["varchar", "text"],
])

/**
 * Tells whether SQL `=` compares the values of two types as they are: both have SQL `=`, and they are one SQL type or of one family of `equalityFamilies`.
 *
 * Types are one SQL type when their cast types are equal, whatever their type parameters and the JavaScript representation of their values.
 * Equal TypeScript types are not enough, such as of `uuid` and `text`, which PostgreSQL does not compare.
 */
export function isEqualityCompatible(left: AnyType, right: AnyType): boolean {
  if (!hasEquality(left) || !hasEquality(right)) {
    return false
  }
  if (left.castType === right.castType) {
    return true
  }
  const family = equalityFamilies.get(left.castType)
  return family !== undefined && family === equalityFamilies.get(right.castType)
}

function defineEqualityOperator<S extends OperatorSignature>(
  implementation: GenericOperatorImplementation<S>,
): EqualityOperator<S> {
  return Object.assign(defineGenericOperator(implementation), { [equalityBrand]: true as const })
}
