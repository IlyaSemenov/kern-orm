import type { ColumnRefNode, SourceNode } from "../../ast/nodes"

import type { CompileContext } from "./context"

/**
 * Sources visible at a position of the statement: the last declared one, and through `outer` those declared before it that are visible from it.
 *
 * A source declared elsewhere in the statement, such as in a sibling subquery, has an alias but is not in the scope, so a reference to it is rejected.
 */
export interface Scope {
  readonly source: SourceNode
  readonly alias: string
  readonly outer: Scope | undefined
}

/**
 * Declares a source of `FROM` on top of `outer` with a new alias.
 *
 * It rejects a source already visible there, such as a query nested in itself: a column reference could not tell its occurrences apart.
 */
export function declareSource(
  context: CompileContext,
  outer: Scope | undefined,
  source: SourceNode,
): Scope {
  if (findAlias(outer, source) !== undefined) {
    throw new Error(
      `An occurrence of ${describeSource(source)} appears where it is already visible, so its column references would be ambiguous`,
    )
  }
  const name = source.kind === "table" ? source.table.name : "subquery"
  return { source, alias: context.createAlias(name), outer }
}

/** Returns the alias of the source of a column reference in `scope`, rejecting a source that is not visible there. */
export function resolveAlias(scope: Scope | undefined, column: ColumnRefNode): string {
  const alias = findAlias(scope, column.source)
  if (alias === undefined) {
    throw new Error(
      `Column "${column.key}" of ${describeSource(column.source)} refers to a source that is not visible where it is used`,
    )
  }
  return alias
}

/** Returns the alias of `source` in `scope`, or `undefined` when the source is not visible there. */
function findAlias(scope: Scope | undefined, source: SourceNode): string | undefined {
  for (let current = scope; current; current = current.outer) {
    if (current.source === source) {
      return current.alias
    }
  }
  return undefined
}

function describeSource(source: SourceNode): string {
  return source.kind === "table" ? `table "${source.table.name}"` : "a subquery"
}
