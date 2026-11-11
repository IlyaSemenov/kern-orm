// Literal values of selections: fields that a record takes from code, which never reach PostgreSQL.

import { operandNode } from "../expression/expression"

/**
 * Field of a selection whose value is `T`, made by `literal`.
 *
 * It is not an expression: it has no SQL, so only a selection takes it.
 */
export class Literal<out T> {
  constructor(
    /** Value of the field in every record, which the query returns as it is. */
    readonly literal: T,
  ) {
    Object.freeze(this)
  }

  /** Rejects the literal as an operand of an expression: a statement has no SQL of it. */
  [operandNode](): never {
    throw new TypeError(
      "A literal is only a selected field and has no SQL; pass a value to an expression through param",
    )
  }
}

// The constraint includes `null`, a primitive, so that TypeScript keeps a literal type such as of `literal("none")`, while `const` would also make objects and arrays readonly.
/**
 * Creates a field of a selection with `value` in every record, without selecting anything in SQL: the query returns the value itself, not a copy of it, whatever it is.
 *
 * It lets a branch of a selection skip a column or a nested query, such as `withHint ? field.hint : literal(null)`.
 * To use a value in SQL, such as in a condition, pass it through `param` instead.
 */
export function literal<T extends {} | null | undefined>(value: T): Literal<T> {
  return new Literal(value)
}
