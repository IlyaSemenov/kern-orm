import * as dbTypes from "kern-db/types"

import { orderingOperators } from "../../expression/operators/ordering"
import { defineType } from "../type"

/** Point in time as a UTC ISO 8601 string with microseconds, such as `2026-01-15T07:00:00.123456Z`; accepts a `Date` too. */
export const timestamptz = /* @__PURE__ */ defineType(dbTypes.timestamptz).withOperators(
  orderingOperators,
)

/** Date and time without a time zone as an ISO 8601 string with microseconds, such as `2026-01-15T10:00:00.000000`. */
export const timestamp = /* @__PURE__ */ defineType(dbTypes.timestamp).withOperators(
  orderingOperators,
)

/** Calendar date as an ISO 8601 string, such as `2026-01-15`. */
export const date = /* @__PURE__ */ defineType(dbTypes.date).withOperators(orderingOperators)

/** Time of day as a string with microseconds, such as `10:00:00.000000`. */
export const time = /* @__PURE__ */ defineType(dbTypes.time).withOperators(orderingOperators)

/** Interval in the PostgreSQL output format, such as `1 day 02:00:00`. */
export const interval = /* @__PURE__ */ defineType(dbTypes.interval).withOperators(
  orderingOperators,
)
