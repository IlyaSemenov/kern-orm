import * as codecs from "kern-db/types"

import { orderingOperators } from "../../expression/operators/ordering"
import { defineType } from "../type"

/** UUID as a string. */
export const uuid = /* @__PURE__ */ defineType(codecs.uuid).withOperators(orderingOperators)
