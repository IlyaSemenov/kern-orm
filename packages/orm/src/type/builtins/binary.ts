import * as codecs from "kern-db/types"

import { equalityOperators } from "../../expression/operators/equality"
import { defineType } from "../type"

/** Binary data; PostgreSQL represents it in hex, which requires the default `bytea_output` setting. */
export const bytea = /* @__PURE__ */ defineType(codecs.bytea).withOperators(equalityOperators)
