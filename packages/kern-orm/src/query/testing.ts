import type { TableSourceNode } from "../ast/nodes"
import type { AnyTable } from "../table/table"

import type { ColumnRefs } from "./column-refs"
import { createSelectionRefs, noContext } from "./column-refs"

/** Creates expressions of the columns of `source`, each with the type of its column, such as to build SQL AST nodes by hand. */
export function createColumnRefs<T extends AnyTable>(source: TableSourceNode): ColumnRefs<T> {
  return createSelectionRefs(source, noContext) as ColumnRefs<T>
}
