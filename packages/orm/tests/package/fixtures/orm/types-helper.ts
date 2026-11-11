// Exports types derived in a module that imports only `kern-orm/types`, as a module of column presets does.
// The package test emits its declarations in a program of its own, where they name the types of the ORM through `kern-orm/types` alone.
import * as t from "kern-orm/types"

/** Nullable type; see the file header. */
export const nullableText = t.text.nullable()

/** Nullable type of numbers; see the file header. */
export const count = t.integer.nullable()

/** Type with PostgreSQL type parameters; see the file header. */
export const decimal = t.numeric.with(10, 2)

/** Type of text with PostgreSQL type parameters; see the file header. */
export const code = t.varchar.with(8)

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

/** Column of the primary key; see the file header. */
export const id = t.uuid.primaryKey()

/** Columns of physical names, one with a default; see the file header. */
export const timestamps = {
  createdAt: t.timestamptz.columnName("created_at").hasDefault(),
  updatedAt: t.timestamptz.columnName("updated_at"),
}
