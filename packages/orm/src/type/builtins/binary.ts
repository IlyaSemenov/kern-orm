import * as dbTypes from "kern-db/types"

import { equalityOperators } from "../../expression/operators/equality"
import { defineType } from "../type"

/** Binary data; PostgreSQL represents it in hex, which requires the default `bytea_output` setting. */
export const bytea = /* @__PURE__ */ defineType(dbTypes.bytea).withOperators(equalityOperators)
