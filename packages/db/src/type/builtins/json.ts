import type { DerivableType } from "../type"
import { defineType } from "../type"

// A symbol of `Symbol.for`, so that every copy of the package has one marker: an application passes it as a plain value to a type of another copy.
/** Marker for a top-level JSON `null` value read or written with `jsonWithJsonNull` or `jsonbWithJsonNull`. */
export const jsonNull: unique symbol = /* @__PURE__ */ Symbol.for("kern-db.jsonNull")

/** Type of `jsonNull` for use in a declared shape, such as `of<Payload | JsonNull>()`. */
export type JsonNull = typeof jsonNull

/** `json` values; `json.of<T>()` declares their shape. */
export const json = /* @__PURE__ */ defineJsonType("json")

/** `jsonb` values; `jsonb.of<T>()` declares their shape. */
export const jsonb = /* @__PURE__ */ defineJsonType("jsonb")

/**
 * `json` values in which a top-level JSON `null` value is `jsonNull`, while `null` stands for `NULL`.
 *
 * `jsonWithJsonNull.of<T | JsonNull>()` declares their shape.
 * PostgreSQL has no `=` for `json`.
 */
export const jsonWithJsonNull = /* @__PURE__ */ defineJsonTypeWithJsonNull("json")

/**
 * `jsonb` values in which a top-level JSON `null` value is `jsonNull`, while `null` stands for `NULL`.
 *
 * `jsonbWithJsonNull.of<T | JsonNull>()` declares their shape.
 */
export const jsonbWithJsonNull = /* @__PURE__ */ defineJsonTypeWithJsonNull("jsonb")

/** Serializes a value as JSON text; values without a JSON representation, such as functions, are rejected. */
export function stringifyJson(value: unknown): string {
  const text = JSON.stringify(value)
  if (text === undefined) {
    throw new TypeError(
      value === jsonNull
        ? "Cannot encode jsonNull with this type; use jsonWithJsonNull or jsonbWithJsonNull to write a JSON null value"
        : `Cannot encode ${typeof value} as JSON`,
    )
  }
  return text
}

// The values are `unknown`, which includes a JSON `null` value, decoded to `null`, as `NULL` is unless `nullableAs` decodes it to another value.
// The accepted values are `{}`, since a `null` that a query passes is `NULL`, so that only `nullable` and `nullableAs` make the type nullable.
function defineJsonType(sqlType: string): DerivableType<unknown, {}> {
  // `transform` rejects a decoder that may return `null`, which a JSON `null` value is here.
  return defineType({ sqlType }).transform<{}, {}>({
    decode: text => JSON.parse(text),
    encode: stringifyJson,
  }) as DerivableType<unknown, {}>
}

// The values are `{}`, the type of every value other than `null` and `undefined`, which includes the marker: a JSON `null` value is the marker, so `null` among the values is only `NULL`, which `nullable` adds.
function defineJsonTypeWithJsonNull(sqlType: string): DerivableType<{}, {}> {
  return defineType({ sqlType }).transform<{}, {}>({
    decode(text) {
      // The parsed value is compared rather than the text, which `json` keeps as written, such as with spaces around `null`; a `null` inside a value stays `null`.
      const value: unknown = JSON.parse(text)
      return value === null ? jsonNull : (value as {})
    },
    encode(value) {
      if (value === jsonNull) {
        return "null"
      }
      const text = stringifyJson(value)
      // Prevents writing a JSON `null` value by accident, such as for `NaN`: it would be read back as the marker.
      if (text === "null") {
        throw new TypeError(
          "Value serializes to a top-level JSON null; to store a JSON null value intentionally, pass jsonNull and include JsonNull in any declared shape",
        )
      }
      return text
    },
  })
}
