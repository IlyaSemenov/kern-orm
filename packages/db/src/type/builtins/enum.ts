import { defineType } from "../type"

/** Creates a type of an existing PostgreSQL enum of `values`. */
export function enumOf<const Values extends readonly string[]>(name: string, _values: Values) {
  // Enums have no type parameters, so a name with parentheses, such as a quoted one, is the cast type as it is.
  return defineType({ sqlType: name, castType: name }).of<Values[number]>()
}
