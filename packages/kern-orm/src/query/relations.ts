// Queries of relations: the runtime contexts of the tables of a schema, whose references in `select` start the correlated queries of their relations.

import { combineNodes } from "../ast/boolean"
import type { ExpressionNode, TableSourceNode } from "../ast/nodes"
import { createNode } from "../ast/nodes"
import type { AnyExpression } from "../expression/expression"
import { toNode } from "../expression/expression"
import type { RelationDefinition, SchemaRelations } from "../schema/relation"

import type { QueryContext } from "./column-refs"
import { noContext } from "./column-refs"
import { createQueryNode } from "./node"
import type { AnySelectQuery } from "./select"
import { SelectQuery } from "./select"

/** Creates the contexts of the queries of the tables under `keys` in a schema of relations `relations`, by table key. */
export function createQueryContexts(
  keys: readonly string[],
  relations: SchemaRelations,
): Readonly<Record<string, QueryContext>> {
  const contexts: Record<string, QueryContext> = Object.create(null)
  for (const key of keys) {
    const named = relations[key]
    if (named === undefined) {
      contexts[key] = noContext
      continue
    }
    // Without a prototype, a relation named as a member of `Object`, such as `__proto__`, stays an own property.
    const getters: PropertyDescriptorMap = Object.create(null)
    for (const name of Object.keys(named)) {
      const definition = named[name] as RelationDefinition
      getters[name] = Object.freeze({
        get(this: ParentRefs) {
          // The target is a table of the schema, so it has a context once all contexts are created.
          return startRelated(this, definition, contexts[definition.targetKey]!)
        },
        enumerable: true,
      })
    }
    contexts[key] = Object.freeze({ relations: Object.freeze(getters) })
  }
  return Object.freeze(contexts)
}

/** References of the callback of `select` whose relation a getter starts, with the columns of the source of the parent row by key. */
type ParentRefs = Readonly<Record<string, AnyExpression>>

/**
 * Starts the query of the records of relation `definition` of the row of `parent`, the references of `select`, in the context of the target table.
 *
 * The relation filter compares the key columns of the target with those of `parent` with SQL `=` directly rather than with the `eq` operators of their types, which a custom type can replace.
 */
function startRelated(
  parent: ParentRefs,
  definition: RelationDefinition,
  context: QueryContext,
): AnySelectQuery {
  const { target, from, to } = definition
  const source: TableSourceNode = Object.freeze({ kind: "table", table: target })
  const conditions: ExpressionNode[] = []
  for (let index = 0; index < from.length; index++) {
    conditions.push(
      createNode({
        kind: "comparison",
        operator: "=",
        left: createNode({ kind: "column", source, key: to[index]! }),
        right: toNode(parent[from[index]!]!),
      }),
    )
  }
  const filters = Object.freeze({ relation: combineNodes("and", conditions) })
  return new SelectQuery(target, createQueryNode(source, definition, filters), context)
}
