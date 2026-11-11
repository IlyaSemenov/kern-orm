import type { DerivableType } from "../type"
import { defineType } from "../type"

/** `json` values; `json.of<T>()` declares their shape. */
export const json = /* @__PURE__ */ defineJsonType("json")

/** `jsonb` values; `jsonb.of<T>()` declares their shape. */
export const jsonb = /* @__PURE__ */ defineJsonType("jsonb")

/** Serializes a value as JSON text; values without a JSON representation, such as functions, are rejected. */
export function stringifyJson(value: unknown): string {
  const text = JSON.stringify(value)
  if (text === undefined) {
    throw new TypeError(`Cannot encode ${typeof value} as JSON`)
  }
  return text
}

// The values are `unknown`, which includes a JSON `null` value, decoded to `null`, which kern-db does not tell from `NULL`.
// The accepted values are `{}`, since a `null` that a query passes is `NULL`, so that only `nullable` makes the type nullable.
function defineJsonType(sqlType: string): DerivableType<unknown, {}> {
  // `transform` rejects a decoder that may return `null`, which a JSON `null` value is here.
  return defineType({ sqlType }).transform<{}, {}>({
    decode: text => JSON.parse(text),
    encode: stringifyJson,
  }) as DerivableType<unknown, {}>
}
