// Exports custom types and a query of SQL text from a module that imports only the root of `kern-orm` and `kern-orm/types`, as a module of presets does.
// The package test emits its declarations in a program of its own of a consumer that cannot resolve kern-db, where they name the types of kern-db through the root of `kern-orm`.
import type { Database } from "kern-orm"
import { defineType, orderingOperators, textOperators } from "kern-orm"
import * as t from "kern-orm/types"

/** Custom type with the operators of text; see the file header. */
export const email = defineType({ sqlType: "citext" }).withOperators({
  ...orderingOperators,
  ...textOperators,
})

/** Custom type of another representation of its values, with type parameters; see the file header. */
export const vector = defineType({ sqlType: "vector" })
  .transform({
    decode: text => JSON.parse(text) as number[],
    encode: (value: number[]) => JSON.stringify(value),
  })
  .withParameters((dimensions: number) => `vector(${dimensions})`)

/** Query of SQL text, whose declaration names the query of kern-db; see the file header. */
export function countForms(database: Database) {
  return database.query`SELECT count(*) FROM form`.get(t.integer)
}
