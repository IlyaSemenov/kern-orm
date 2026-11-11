import type { ComparisonNode } from "../../ast/nodes"
import { createList } from "../../ast/nodes"
import type { NumberTypeOperators } from "../../type/number"
import { getIntegerType } from "../../type/number"
import { getTextType } from "../../type/text"
import type { AnyType } from "../../type/type"
import type { AnyExpression, Expression } from "../expression"
import { toBooleanExpression, toExpression, toNode } from "../expression"

import type { BooleanResult, Operand, OperandValue } from "./comparison"
import { compareNodes } from "./comparison"
import type { MergeOperators, NoOperators } from "./definitions"
import type { GenericOperator, OperatorSignature } from "./generic"
import { defineGenericOperator } from "./generic"
import type { orderingOperators } from "./ordering"

/** Signature of pattern matching: patterns stay strings even when the text values are transformed. */
export interface PatternSignature extends OperatorSignature {
  readonly method: <V extends Operand<string>>(
    pattern: V,
  ) => Expression<BooleanResult<this["T"] | OperandValue<V>>>
}

/** Signature of `lower`, `upper`, and `trim`: a value of `text`, whatever the representation of the text values, and `NULL` when the text can be. */
export interface TextConversionSignature extends OperatorSignature {
  readonly method: () => Expression<
    string | (null extends this["T"] ? null : never),
    TextTypeOperators
  >
}

/** Signature of `length`: the number of characters of the text, and `NULL` when the text can be. */
export interface TextLengthSignature extends OperatorSignature {
  readonly method: () => Expression<
    number | (null extends this["T"] ? null : never),
    NumberTypeOperators
  >
}

/** Operators of `textOperators`. */
export type TextOperators = {
  like: GenericOperator<PatternSignature, AnyExpression<string | null>>
  ilike: GenericOperator<PatternSignature, AnyExpression<string | null>>
  lower: GenericOperator<TextConversionSignature, AnyExpression<string | null>>
  upper: GenericOperator<TextConversionSignature, AnyExpression<string | null>>
  trim: GenericOperator<TextConversionSignature, AnyExpression<string | null>>
  length: GenericOperator<TextLengthSignature, AnyExpression<string | null>>
}

/** Operators of the built-in text types: those of `orderingOperators` and `textOperators`. */
export type TextTypeOperators = MergeOperators<
  MergeOperators<NoOperators, typeof orderingOperators>,
  TextOperators
>

/**
 * Operators of text types: pattern matching with `LIKE` and `ILIKE`, `lower` and `upper`, which convert the case of the text, `trim`, which removes spaces from both of its ends, and `length`, which counts its characters.
 *
 * A string pattern is sent as it is; `param(type, pattern)` encodes it with a type.
 */
export const textOperators: TextOperators = {
  like: /* @__PURE__ */ createPatternComparison("LIKE"),
  ilike: /* @__PURE__ */ createPatternComparison("ILIKE"),
  lower: /* @__PURE__ */ createTextConversion("lower"),
  upper: /* @__PURE__ */ createTextConversion("upper"),
  trim: /* @__PURE__ */ createTextConversion("btrim"),
  length: /* @__PURE__ */ defineGenericOperator<TextLengthSignature, AnyExpression<string | null>>(
    self => callTextFunction("length", self, getIntegerType()) as never,
  ),
}

function createPatternComparison(operator: ComparisonNode["operator"]) {
  return defineGenericOperator<PatternSignature, AnyExpression<string | null>>((self, pattern) =>
    toBooleanExpression(
      // Patterns are PostgreSQL text, independent of the representation of the expression values.
      compareNodes(operator, toNode(self), pattern, undefined),
    ),
  )
}

function createTextConversion(name: string) {
  return defineGenericOperator<TextConversionSignature, AnyExpression<string | null>>(
    self => callTextFunction(name, self, getTextType()) as never,
  )
}

/** Calls a SQL function of text whose result has `type`, whatever the type of the expression: a decoder of a transformed type expects values that it encoded rather than results of the function. */
function callTextFunction(name: string, self: AnyExpression, type: AnyType) {
  return toExpression(createList(`${name}(`, [toNode(self)], ")"), type)
}
