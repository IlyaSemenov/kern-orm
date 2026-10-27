import type { ApplySignature, GenericOperatorSignature } from "./generic"

/** Operator implementations by name; each receives the expression it is called on, followed by the call arguments. */
// oxlint-disable-next-line typescript/no-explicit-any -- operators accept and return arbitrary values
export type OperatorDefinitions<Self = any> = Record<
  string,
  (self: Self, ...args: any[]) => unknown
>

/** Empty set of operators, of an expression with the base operators only. */
export type NoOperators = Record<never, never>

/** Operators `O` replacing operators of `A` with the same names. */
export type MergeOperators<A extends OperatorDefinitions, O extends OperatorDefinitions> = Omit<
  A,
  keyof O
> &
  O

/** Operator methods of an expression of type `T` accepting values of type `I`, without the expression parameter of their definitions. */
export type BoundOperators<O extends OperatorDefinitions, T, I = T> = {
  [K in keyof O]: O[K] extends GenericOperatorSignature<infer S>
    ? ApplySignature<S, T, I>
    : // oxlint-disable-next-line typescript/no-explicit-any -- matches any operator definition
      O[K] extends (self: any, ...args: infer A) => infer R
      ? (...args: A) => R
      : never
}
