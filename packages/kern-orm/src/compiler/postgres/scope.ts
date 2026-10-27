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
  // A derived source that replaces an occurrence of a table is ambiguous where the occurrence or another source that replaces it is visible.
  if (
    findSource(outer, source) !== undefined ||
    (source.kind === "derived" &&
      source.replaces !== undefined &&
      findSource(outer, source.replaces) !== undefined)
  ) {
    throw new Error(
      `An occurrence of ${describeSource(source)} appears where it is already visible, so its column references would be ambiguous`,
    )
  }
  const name =
    source.kind === "table" ? source.table.name : (source.replaces?.table.name ?? "subquery")
  return { source, alias: context.createAlias(name), outer }
}

/**
 * Returns the declared source that a column reference reads in `scope`: its source, or a derived source that replaces it; rejects a source that is not visible there.
 */
export function resolveSource(scope: Scope | undefined, column: ColumnRefNode): Scope {
  const declared = findSource(scope, column.source)
  if (declared === undefined) {
    throw new Error(
      `Column "${column.key}" of ${describeSource(column.source)} refers to a source that is not visible where it is used`,
    )
  }
  return declared
}

/** Returns the declared source of `scope` that is `source` or replaces it, or `undefined` when the source is not visible there. */
function findSource(scope: Scope | undefined, source: SourceNode): Scope | undefined {
  for (let current = scope; current; current = current.outer) {
    const declared = current.source
    if (declared === source || (declared.kind === "derived" && declared.replaces === source)) {
      return current
    }
  }
  return undefined
}

function describeSource(source: SourceNode): string {
  return source.kind === "table" ? `table "${source.table.name}"` : "a subquery"
}
