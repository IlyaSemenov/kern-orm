import { encodeBytea } from "./codecs/bytea"
import { stringifyJson } from "./codecs/json"

/** Encodes a parameter without a type, such as a value interpolated into `sql`, by its JavaScript type. */
export function encodeUntyped(value: unknown): string {
  if (typeof value === "string") {
    return value
  }
  if (typeof value === "number" || typeof value === "bigint") {
    return String(value)
  }
  if (typeof value === "boolean") {
    return value ? "t" : "f"
  }
  if (value instanceof Date) {
    return value.toISOString()
  }
  if (value instanceof Uint8Array) {
    return encodeBytea(value)
  }
  if (Array.isArray(value)) {
    throw new TypeError(
      "Pass an array with param(type, value), so that its elements are encoded by type",
    )
  }
  return stringifyJson(value)
}
