import * as dbTypes from "kern-db/types"

import { equalityOperators } from "../../expression/operators/equality"
import { vectorOperators } from "../../expression/operators/vector"
import { defineType } from "../type"

/** `vector` of the pgvector extension as an array of numbers, such as `[1, 2, 3]`, with the operators of its distances; `vector.with(dimensions)` sets the number of its dimensions. */
export const vector = /* @__PURE__ */ defineType(dbTypes.vector)
  .withOperators(equalityOperators)
  .withOperators(vectorOperators)
