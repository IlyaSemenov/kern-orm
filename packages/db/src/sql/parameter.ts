// Parameters of statements: the values that a parameter takes without a type, their PostgreSQL text representations, and the numbering of the parameters of a statement.

import type { TextValue } from "../driver"
import { encodeBoolean } from "../type/builtins/boolean"
import { encodeBytea } from "../type/builtins/bytea"
import type { AnyType } from "../type/type"

/** Value that a parameter takes without a type, encoded by its JavaScript type; `null` is `NULL`. */
export type UntypedValue = string | number | bigint | boolean | null | Date | Uint8Array

/** Tells whether a parameter takes `value` without a type. */
function isUntypedValue(value: unknown): value is UntypedValue {
  switch (typeof value) {
    case "string":
    case "number":
    case "bigint":
    case "boolean":
      return true
    case "object":
      return value === null || value instanceof Date || value instanceof Uint8Array
    default:
      return false
  }
}

/**
 * Checks that a parameter takes `value` without a type, such as an interpolated value of a template, so that an error points at the template rather than at the compilation of its statement.
 *
 * It rejects `undefined` and a value that a parameter does not take without a type, such as an object or an array.
 */
export function assertUntypedValue(value: unknown): asserts value is UntypedValue {
  if (!isUntypedValue(value)) {
    rejectUntypedValue(value)
  }
}

/**
 * Rejects `value` as the value of a parameter without a type.
 *
 * Only a type tells how PostgreSQL reads an object or an array, such as JSON or an array of a type, so they are not encoded by a guess.
 */
export function rejectUntypedValue(value: unknown): never {
  if (value === undefined) {
    // An omitted value must not turn into SQL silently.
    throw new TypeError("Query parameter is undefined; use null for NULL")
  }
  const kind = Array.isArray(value)
    ? "an array"
    : typeof value === "object"
      ? "an object"
      : `a ${typeof value}`
  throw new TypeError(
    `A parameter without a type takes a string, a number, a bigint, a boolean, null, a Date, or a Uint8Array, not ${kind}; pass JSON or an array with param()`,
  )
}

// The values without a type are encoded by a function of their own, which keeps this one small for the parameters with a type, such as the values of an insert.
/** Encodes the value of a parameter with `type`, or by its JavaScript type without one; it rejects `undefined`, and a value that a parameter does not take without a type. */
export function encodeParameter(value: unknown, type: AnyType | undefined): TextValue {
  if (value === undefined) {
    rejectUntypedValue(value)
  }
  if (value === null) {
    return null
  }
  return type !== undefined ? type.encode(value) : encodeUntypedValue(value)
}

/** Encodes a value other than `null` of a parameter without a type by its JavaScript type. */
function encodeUntypedValue(value: unknown): string {
  if (typeof value === "string") {
    return value
  }
  if (typeof value === "number" || typeof value === "bigint") {
    return String(value)
  }
  if (typeof value === "boolean") {
    return encodeBoolean(value)
  }
  if (value instanceof Date) {
    return value.toISOString()
  }
  if (value instanceof Uint8Array) {
    return encodeBytea(value)
  }
  return rejectUntypedValue(value)
}

// The protocol of PostgreSQL counts the parameters of a statement in 16 bits.
/** Most parameters that PostgreSQL takes in a statement. */
export const maxParameters = 65535

/** Adds `value` to `parameters` of a statement and returns its placeholder, such as `$1`, rejecting more parameters than PostgreSQL takes. */
export function bindParameter(parameters: TextValue[], value: TextValue): string {
  if (parameters.length === maxParameters) {
    throw new Error(
      `Statement has more than ${maxParameters} parameters, which PostgreSQL does not take; split it into several statements, such as in a transaction`,
    )
  }
  parameters.push(value)
  return `$${parameters.length}`
}
