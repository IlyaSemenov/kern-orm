import * as dbTypes from "kern-db/types"

import { equalityOperators } from "../../expression/operators/equality"
import { defineType } from "../type"

/**
 * `json` values; `json.of<T>()` declares their shape.
 * PostgreSQL has no `=` for `json`, so its expressions have no `eq`, `ne`, or `in`.
 */
export const json = /* @__PURE__ */ defineType(dbTypes.json)

/** `jsonb` values; `jsonb.of<T>()` declares their shape. */
export const jsonb = /* @__PURE__ */ defineType(dbTypes.jsonb).withOperators(equalityOperators)

/**
 * `json` values in which a top-level JSON `null` value is `jsonNull`, while `null` stands for `NULL`.
 *
 * `jsonWithJsonNull.of<T | JsonNull>()` declares their shape.
 * PostgreSQL has no `=` for `json`, so its expressions have no `eq`, `ne`, or `in`.
 */
export const jsonWithJsonNull = /* @__PURE__ */ defineType(dbTypes.jsonWithJsonNull)

/**
 * `jsonb` values in which a top-level JSON `null` value is `jsonNull`, while `null` stands for `NULL`.
 *
 * `jsonbWithJsonNull.of<T | JsonNull>()` declares their shape.
 */
export const jsonbWithJsonNull = /* @__PURE__ */ defineType(
  dbTypes.jsonbWithJsonNull,
).withOperators(equalityOperators)
