import type { TableSourceNode } from "../ast/nodes"
import { createNode } from "../ast/nodes"
import type { Expression } from "../expression/expression"
import { toExpression } from "../expression/expression"
import type { SchemaContext, TableContext, UsedRelation } from "../schema/relation"
import type { AnyTable, ColumnOperators, ColumnValues, Selectable } from "../table/table"

import type { RelationRows } from "./rows"
import type { EmptyRecord, InitialQueryState, SelectQuery } from "./select"

/** References to the columns of the query source, passed to query callbacks. */
export type ColumnRefs<T extends AnyTable> = {
  readonly [K in keyof T["columns"]]: Expression<
    Selectable<T>[K],
    ColumnOperators<T, K>,
    ColumnValues<T>[K]
  >
}

// Without relations for a context of any table, `DbQuery` of a `Db` keeps accepting queries of every schema context.
/**
 * Queries of the records of the relations of the table of schema context `C`, by relation name, which the callback of `select` receives beside the columns.
 *
 * A relation name is never a column key of its table.
 * A context whose table key is not known, such as one of a query of any schema, has no relations.
 */
export type RelationRefs<C extends SchemaContext> = string extends C["key"]
  ? EmptyRecord
  : C["key"] extends keyof C["relations"]
    ? RelationQueries<C["relations"], C["key"]>
    : EmptyRecord

type RelationQueries<R extends SchemaContext["relations"], K extends keyof R & string> = {
  readonly [N in keyof R[K]]: RelatedQuery<R, K, N & string>
}

/** Unbound query of the records of relation `N` of the table under key `K` of a schema of relations `R`, in the schema context of its target and the rows mode of the relation. */
type RelatedQuery<
  R extends SchemaContext["relations"],
  K extends keyof R & string,
  N extends keyof R[K] & string,
> = SelectQuery<
  InitialQueryState<
    R[K][N]["target"],
    TableContext<R, R[K][N]["targetKey"]>,
    UsedRelation<K, N, R[K][N]>,
    RelationRows<R[K][N]["kind"], R[K][N]["required"]>
  >
>

/** Runtime context of the queries of a table in the schema they start from. */
export interface QueryContext {
  /** Getters of the queries of the relations of the table, which the references of `select` have as their own properties and which read the key columns from them. */
  readonly relations: PropertyDescriptorMap
}

/** Context of a query whose table has no relations, such as one of `from(table)`. */
export const noContext: QueryContext = /* @__PURE__ */ Object.freeze({
  relations: /* @__PURE__ */ Object.freeze({}),
})

/** Creates expressions of the columns of `source`, each with the type of its column. */
export function createColumnRefs<T extends AnyTable>(source: TableSourceNode): ColumnRefs<T> {
  return addColumns({}, source) as ColumnRefs<T>
}

// The relations are own enumerable properties like the columns, so that the references and a spread of them hold every field their type has.
/** Creates the references of the callback of `select` over `source`: its columns, and the relations of `context`. */
export function createSelectionRefs(source: TableSourceNode, context: QueryContext): object {
  return Object.defineProperties(addColumns({}, source), context.relations)
}

function addColumns(refs: Record<string, unknown>, source: TableSourceNode): object {
  const { columns } = source.table
  for (const key of Object.keys(columns)) {
    refs[key] = toExpression(createNode({ kind: "column", source, key }), columns[key]!.type)
  }
  return refs
}
