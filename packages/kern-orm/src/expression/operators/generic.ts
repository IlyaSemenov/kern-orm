import type { AnyExpression } from "../expression"

declare const operatorSignature: unique symbol

/** Runtime mark of generic operators. */
const genericOperatorBrand = Symbol("kern-orm.genericOperator")

/**
 * Signature of a generic operator: its method on an expression of values `T` that accepts compared values `I`.
 *
 * An interface extending it declares `method` with `this["T"]` and `this["I"]`, such as `(value: Operand<this["T"], this["I"]>) => Expression<boolean>`.
 */
export interface OperatorSignature {
  readonly T: unknown
  readonly I: unknown
  // oxlint-disable-next-line typescript/no-explicit-any -- methods take and return arbitrary values
  readonly method: (...args: any[]) => unknown
}

/**
 * Method of signature `S` on an expression of values `T` accepting values `I`.
 *
 * A signature reads the value types from `this`, because TypeScript cannot instantiate a generic function type with type arguments.
 */
export type ApplySignature<S extends OperatorSignature, T, I> = (S & {
  readonly T: T
  readonly I: I
})["method"]

/** Implementation of a generic operator of signature `S`: the expression it is called on, followed by the call arguments. */
export type GenericOperatorImplementation<
  S extends OperatorSignature,
  Self extends AnyExpression = AnyExpression,
> = (
  self: Self,
  ...args: Parameters<ApplySignature<S, unknown, unknown>>
) => ReturnType<ApplySignature<S, unknown, unknown>>

/** Operator created by `defineGenericOperator`, whose method has signature `S` on the expression it is called on. */
export interface GenericOperator<
  S extends OperatorSignature,
  Self extends AnyExpression = AnyExpression,
>
  extends GenericOperatorImplementation<S, Self>, GenericOperatorSignature<S> {}

/** Inference metadata of a generic operator, independent of its callable implementation. */
// Matching only metadata avoids recursively evaluating Boolean operators while inferring their own signatures.
export interface GenericOperatorSignature<S extends OperatorSignature> {
  readonly [genericOperatorBrand]: true
  /** Signature for type inference; absent at runtime. */
  readonly [operatorSignature]?: S
}

/**
 * Defines a generic operator: one definition for every type, which works with the values of the expression it is called on.
 *
 * It receives the expression with its own type, including a type derived with `transform`, and its method has signature `S` with the value types of the expression, such as `lt` of `orderingOperators`.
 * An operator defined as a plain function works with the values of the type it was added to instead.
 * `Self` restricts the types it can be added to with `withOperators`; derived types keep the operator after `transform`.
 */
export function defineGenericOperator<
  S extends OperatorSignature,
  Self extends AnyExpression = AnyExpression,
>(implementation: GenericOperatorImplementation<S>): GenericOperator<S, Self> {
  // Binding creates a new function, so marking it leaves the implementation an ordinary operator.
  return Object.assign(implementation.bind(undefined), {
    [genericOperatorBrand]: true as const,
  })
}

/** Tells whether an operator is generic, created by `defineGenericOperator`. */
export function isGenericOperator(operator: unknown): boolean {
  return typeof operator === "function" && genericOperatorBrand in operator
}
