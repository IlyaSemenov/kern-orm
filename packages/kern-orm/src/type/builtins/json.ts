import type { NoOperators, OperatorDefinitions } from "../../expression/operators/definitions"
import { equalityOperators } from "../../expression/operators/equality"
import { stringifyJson } from "../codecs/json"
import type { Type } from "../type"
import { defineType } from "../type"

/** JSON type of `unknown` values with operators `O` and `of`, which declares their shape. */
export type JsonType<O extends OperatorDefinitions = NoOperators> = Type<unknown, unknown, O> & {
  /** Declares the shape of the values, which is not validated at runtime. */
  of<T>(): Type<T, T, O>
}

function createJsonType(sqlType: string) {
  return defineType({ sqlType }).transform({
    decode: (text): unknown => JSON.parse(text),
    encode: stringifyJson,
  })
}

function addShape<O extends OperatorDefinitions>(type: Type<unknown, unknown, O>): JsonType<O> {
  // The shape exists only in TypeScript, so `of` returns the same type.
  return Object.freeze({ ...type, of: () => type }) as JsonType<O>
}

/** `json` values; `json.of<T>()` declares their shape. PostgreSQL has no `=` for `json`, so its expressions have no `eq`, `ne`, or `in`. */
export const json = /* @__PURE__ */ addShape(/* @__PURE__ */ createJsonType("json"))

/** `jsonb` values; `jsonb.of<T>()` declares their shape. */
export const jsonb = /* @__PURE__ */ addShape(
  /* @__PURE__ */ createJsonType("jsonb").withOperators(equalityOperators),
)
