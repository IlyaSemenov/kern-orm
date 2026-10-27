import { orderingOperators } from "../../expression/operators/ordering"
import { defineType } from "../type"

/** Creates a type of an existing PostgreSQL enum; values are ordered as declared in the enum. */
export function enumOf<const Values extends readonly string[]>(name: string, _values: Values) {
  // Enums have no type parameters, so a name with parentheses, such as a quoted one, is the cast type as it is.
  return defineType({ sqlType: name, castType: name })
    .transform({
      decode: value => value as Values[number],
      encode: (value: Values[number]) => value,
    })
    .withOperators(orderingOperators)
}
