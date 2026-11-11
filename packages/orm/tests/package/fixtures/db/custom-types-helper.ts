// Exports custom types from a module that imports `defineType` of `kern-db` and `kern-db/types`, as a module of shared types does; the package test emits its declarations.
import { defineType } from "kern-db"
import * as t from "kern-db/types"

/** Custom type of the text representations; see the file header. */
export const ltree = defineType({ sqlType: "ltree" })

/** Custom type of another representation of its values, with type parameters; see the file header. */
export const vector = defineType({ sqlType: "vector" })
  .transform({
    decode: text => JSON.parse(text) as number[],
    encode: (value: number[]) => JSON.stringify(value),
  })
  .withParameters((dimensions: number) => `vector(${dimensions})`)

/** Nullable array of a custom type; see the file header. */
export const paths = t.array(ltree).nullable()
