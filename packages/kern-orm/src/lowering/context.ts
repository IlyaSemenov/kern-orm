// What lowering checks the queries of a statement against at any depth, and the checks themselves.

import type { SelectNode } from "../ast/nodes"
import type { AnyDb } from "../execution/db"
import type { QueryNode } from "../query/node"
import type { RelationDefinition } from "../schema/relation"
import { formatRelationName } from "../schema/relation"

/** Context of lowering a statement: what it checks its queries against at any depth, and the lowering of a query that the lowering of its expressions and projections recurses into. */
export interface LoweringContext {
  /** Relation definitions whose records the queries may select, such as the relations of the schema of a `Db`, or `undefined` for any. */
  readonly definitions: ReadonlySet<RelationDefinition> | undefined
  /** `Db` that runs the statement, the only one whose bound queries the statement may nest, or `undefined` for none, such as for `toSQL` of an unbound query. */
  readonly db: AnyDb | undefined
  /**
   * Lowers a query nested in the statement to its select statement, as `lowerQuery` does, or as `lowerStatement` does when `positions` is set.
   *
   * The context carries it so that the modules of the lowering of expressions and projections do not import the lowering of queries, which imports them.
   */
  readonly lowerSelect: (node: QueryNode, positions: boolean) => SelectNode
}

/** Rejects a query of a relation outside the definitions of `context`. */
export function checkRelation(node: QueryNode, context: LoweringContext): void {
  const { relation } = node
  const { definitions } = context
  // A relation is checked by identity, so a relation of the same name and keys declared by another schema is rejected.
  if (relation !== undefined && definitions !== undefined && !definitions.has(relation)) {
    throw new Error(
      `Relation "${formatRelationName(relation.key, relation.name)}" is not part of the schema`,
    )
  }
}

// The statement runs with the options of its Db, such as its PostgreSQL schema, so a nested query bound to a Db runs only in a statement of that Db.
/** Rejects a nested query bound to `db`, which the error names as `subject`, unless `db` is the `Db` of `context` or `undefined`. */
export function checkDb(db: AnyDb | undefined, context: LoweringContext, subject: string): void {
  if (db !== undefined && db !== context.db) {
    throw new Error(
      context.db === undefined
        ? `${subject} is bound to a Db, so only that Db can compile the query`
        : `${subject} is bound to another Db`,
    )
  }
}
