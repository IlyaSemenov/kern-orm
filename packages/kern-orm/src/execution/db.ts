import type { CompiledQuery } from "../compiler/postgres/compile"
import { compileSelect } from "../compiler/postgres/compile"
import { lowerStatement } from "../lowering/lower"
import { createQueryContexts } from "../query/relations"
import type { QueryResult } from "../query/rows"
import type {
  AnySelectQuery,
  BoundSelectQuery,
  EmptyRecord,
  InitialQueryState,
  QueryOfState,
  QueryStateOf,
} from "../query/select"
import { bindQuery, startQuery } from "../query/select"
import { decodeResult } from "../result/result"
import type {
  SchemaRelations,
  TableContext,
  UsableRelation,
  UsedRelation,
} from "../schema/relation"
import { collectDefinitions } from "../schema/relation"
import type { AnySchema, Schema, Tables } from "../schema/schema"
import { defineEntries, schemaRelations } from "../schema/schema"
import type { AnyTable } from "../table/table"

import type { Database } from "./database"
import type { SqlStatement } from "./driver"
import { createStatement } from "./driver"

/** Physical placement of the tables of a schema bound to a database. */
export interface BindOptions {
  /** PostgreSQL schema of the tables; a function is called on every query, such as to resolve the current tenant. */
  schemaName?: string | (() => string)
}

/**
 * Schema bound to a database with `database.bind`.
 *
 * Its table entries start queries bound to it, which execute when awaited.
 */
export type Db<T extends Tables, R extends SchemaRelations = EmptyRecord> = DbEntries<T, R> &
  DbMethods<T, R>

/** Bound query entry points; each access starts a query over a new table occurrence. */
type DbEntries<T extends Tables, R extends SchemaRelations> = {
  readonly [K in keyof T]: BoundSelectQuery<InitialQueryState<T[K], TableContext<R, K>>>
}

// A `QueryOfState` rather than a `SelectQuery`, so that each call compares the query by its state rather than member by member.
/** Bound or unbound query over a table of `T` that selects records only of relations of `R`. */
type DbQuery<T extends Tables, R extends SchemaRelations> = QueryOfState<
  DbQueryState<T[keyof T], UsableRelation<R>>
>

/** State of a query that a `Db` can execute: over table `T`, selecting records only of relations `U`. */
export interface DbQueryState<T extends AnyTable, U extends UsedRelation> extends QueryStateOf<T> {
  readonly uses: U
}

interface DbMethods<T extends Tables, R extends SchemaRelations> {
  readonly $schema: Schema<T, R>
  // Generic like `$execute`, so that comparing `Db` types compares its type parameter rather than the members of queries.
  /**
   * Compiles a query over the tables of the schema into SQL text and parameters.
   *
   * A query bound to another `Db`, and a query of a relation that the schema does not have, at any depth, are rejected.
   */
  $compile<Q extends DbQuery<T, R>>(query: Q): SqlStatement
  // The whole query is inferred rather than its state, so that a union of queries, such as of an optional query and a required one, gives the union of their results.
  /**
   * Executes a query over the tables of the schema.
   *
   * A query bound to another `Db`, and a query of a relation that the schema does not have, at any depth, are rejected.
   */
  $execute<Q extends DbQuery<T, R>>(query: Q): Promise<QueryResult<Q["types"]>>
  /**
   * Runs `callback` in a transaction of the database, shared by every schema bound to it.
   *
   * Inside an existing transaction, it starts a nested transaction.
   */
  $transaction<Result>(callback: () => Promise<Result>): Promise<Result>
}

/**
 * `Db` of schema `S`, such as the type of a parameter of code shared by several schemas.
 *
 * A `Db` of a schema that includes `S` is a `Db` of `S` too.
 */
export type DbOf<S extends AnySchema> = Db<S["$tables"], S[typeof schemaRelations]>

/** `Db` of any schema. */
// oxlint-disable-next-line typescript/no-explicit-any -- any Db regardless of its tables
export type AnyDb = Db<any, any>

/** Binds `schema` to `database`; see `Database.bind`. */
export function bindSchema<T extends Tables, R extends SchemaRelations>(
  schema: Schema<T, R>,
  database: Database,
  options: BindOptions = {},
): Db<T, R> {
  const tables = new Set<AnyTable>(Object.values(schema.$tables))
  const relations = schema[schemaRelations]
  const definitions = collectDefinitions(relations)
  // Changing the options object after binding does not change the Db.
  const { schemaName } = options

  function compile(executed: DbQuery<T, R>): CompiledQuery {
    // Only a `SelectQuery` has the protected mark that `QueryOfState` inherits from its base class.
    const query = executed as AnySelectQuery
    if (query.db !== undefined && query.db !== db) {
      throw new Error("Cannot run a query bound to another Db")
    }
    return compileSelect(
      lowerStatement(query.node, definitions, db),
      { schemaName: typeof schemaName === "function" ? schemaName() : schemaName },
      tables,
    )
  }

  const methods: DbMethods<T, R> = {
    $schema: schema,
    $compile(query) {
      const { text, parameters } = compile(query)
      return createStatement(text, parameters)
    },
    async $execute<Q extends DbQuery<T, R>>(query: Q) {
      const compiled = compile(query)
      const { rows } = await database.execute(compiled)
      return decodeResult(compiled, rows) as QueryResult<Q["types"]>
    },
    $transaction: callback => database.transaction(callback),
  }
  const contexts = createQueryContexts(Object.keys(schema.$tables), relations)
  const db: Db<T, R> = defineEntries(methods, schema.$tables, key =>
    bindQuery(startQuery(schema.$tables[key]!, contexts[key]!), db),
  )
  return db
}
