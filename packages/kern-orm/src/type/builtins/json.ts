import { stringifyJson } from "../../database/codecs/json"
import { equalityOperators } from "../../expression/operators/equality"
import type { Type } from "../type"
import { defineType } from "../type"

// The values are `unknown`, which includes a JSON `null` value, decoded to `null`, which kern-orm does not tell from `NULL`.
// The accepted values are `{}`, since a `null` that a query passes is `NULL`, so that only `nullable` makes the type nullable.
function createJsonType(sqlType: string): Type<unknown, {}> {
  // `transform` rejects a decoder that may return `null`, which a JSON `null` value is here.
  return defineType({ sqlType }).transform<{}, {}>({
    decode: text => JSON.parse(text),
    encode: stringifyJson,
  }) as Type<unknown, {}>
}

/** `json` values; `json.of<T>()` declares their shape. PostgreSQL has no `=` for `json`, so its expressions have no `eq`, `ne`, or `in`. */
export const json = /* @__PURE__ */ createJsonType("json")

/** `jsonb` values; `jsonb.of<T>()` declares their shape. */
export const jsonb = /* @__PURE__ */ createJsonType("jsonb").withOperators(equalityOperators)
