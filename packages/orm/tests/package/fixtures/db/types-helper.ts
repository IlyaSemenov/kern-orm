// Exports types derived in a module that imports only `kern-db/types`, as a module of shared types does.
// The package test emits its declarations in a program of its own, where they name the types of kern-db through `kern-db/types` alone.
import * as t from "kern-db/types"

/** Nullable type; see the file header. */
export const nullableText = t.text.nullable()

/** Type with PostgreSQL type parameters; see the file header. */
export const decimal = t.numeric.with(10, 2)

/** Type of another representation of its values; see the file header. */
export const timestamptzDate = t.timestamptz.transform({ decode: value => new Date(value) })

/** Type of narrowed values; see the file header. */
export const status = t.text.of<"draft" | "published">()

/** Nullable JSON type of a declared shape; see the file header. */
export const payload = t.jsonb.of<{ url: string }>().nullable()

/** Array type of an element type with type parameters; see the file header. */
export const codes = t.array(t.varchar.with(8))

/** Type of a PostgreSQL enum; see the file header. */
export const priority = t.enum("priority", ["low", "high"])
