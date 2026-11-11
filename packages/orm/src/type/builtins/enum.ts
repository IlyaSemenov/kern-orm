import * as dbTypes from "kern-db/types"

import { orderingOperators } from "../../expression/operators/ordering"
import { defineType } from "../type"

/** Creates a type of an existing PostgreSQL enum; values are ordered as declared in the enum. */
export function enumOf<const Values extends readonly string[]>(name: string, values: Values) {
  return defineType(dbTypes.enum(name, values)).withOperators(orderingOperators)
}
