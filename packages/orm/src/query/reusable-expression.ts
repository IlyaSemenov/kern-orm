import type { AnyExpression } from "../expression/expression"
import type { NoRelations, SchemaContext } from "../schema/relation"
import type { AnyTable } from "../table/table"

import type { ColumnRefs, RelationRefs } from "./column-refs"
import type { ScalarQuery } from "./operand"
import type { TableOrQuery } from "./select"

/**
 * Defines a reusable expression of a table, which the callbacks of queries over the table call with their columns and any further arguments, such as to filter by it and select it in one query.
 *
 * `expression` returns an expression or a query of one value, and a call has its type, so that a selected field has its values and an expression has its operators.
 * Defined with a query of a schema or a `Db`, such as `schema.form`, it receives the queries of the relations of the table in that schema, and queries whose schema has them can call it.
 * Defined with a table, it receives only the columns, and every query of the table can call it, also one without relations, such as of `from`.
 */
export function defineExpression<
  T extends AnyTable,
  R extends AnyExpression | ScalarQuery,
  A extends unknown[],
  C extends SchemaContext = NoRelations,
>(
  table: TableOrQuery<T, C>,
  expression: (columns: ColumnRefs<T> & RelationRefs<C>, ...args: A) => R,
): (columns: ColumnRefs<T> & RelationRefs<C>, ...args: A) => R
export function defineExpression(_table: unknown, expression: unknown): unknown {
  return expression
}
