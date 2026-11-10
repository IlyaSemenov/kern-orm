import type { CompiledQuery } from "../compiler/postgres/compile"
import { compileStatement } from "../compiler/postgres/compile"
import { toRawSqlNode } from "../expression/sql"
import { lowerStatement } from "../lowering/lower"
import type { TransformedQuery, TransformedQueryState } from "../query/conversion"
import type { SelectQueryKind } from "../query/kind"
import type { MutationQuery, MutationQueryState } from "../query/mutation"
import type { RecordQuery, RecordQueryState, SelectionState } from "../query/record"
import { startRecordQuery } from "../query/record"
import { createQueryContexts } from "../query/relations"
import type { QueryResult } from "../query/rows"
import type { BoundSelectQuery, QueryOf } from "../query/select"
import { bindQuery, startQuery } from "../query/select"
import type { Selection } from "../query/selection"
import type { InitialSqlQueryState, SqlQuery, SqlQueryState } from "../query/sql-query"
import { startSqlQuery } from "../query/sql-query"
import type { EmptyRecord, QueryStateOf, TableQueryState } from "../query/state"
import { decodeStatement } from "../result/result"
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

import type { Database, SessionOptions, TransactionOptions } from "./database"
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

/** Bound query entry points; each access starts a query over a new table occurrence, of the one row of a singleton table. */
type DbEntries<T extends Tables, R extends SchemaRelations> = {
  readonly [K in keyof T]: BoundSelectQuery<TableQueryState<T[K], TableContext<R, K>>>
}

/** Bound or unbound query over a table of `T`, also converted by `transform`, of `$select`, or that changes the rows of a table of `T`, that selects records only of relations of `R`, or a query of SQL text. */
type DbQuery<T extends Tables, R extends SchemaRelations> =
  | QueryOf<DbQueryState<T[keyof T], UsableRelation<R>>>
  | TransformedQuery<TransformedQueryState<T[keyof T], unknown, UsableRelation<R>>, SelectQueryKind>
  | RecordQuery<RecordQueryState<unknown, UsableRelation<R>>, SelectQueryKind>
  | MutationQuery<DbMutationState<T[keyof T], UsableRelation<R>>, SelectQueryKind>
  | SqlQuery<SqlQueryState>

/** State of a query that a `Db` can execute: over table `T`, selecting records only of relations `U`. */
export interface DbQueryState<T extends AnyTable, U extends UsedRelation> extends QueryStateOf<T> {
  readonly uses: U
}

/** State of an insert, update, or delete query that a `Db` can execute: of table `T`, selecting records only of relations `U`. */
export interface DbMutationState<
  T extends AnyTable,
  U extends UsedRelation,
> extends MutationQueryState {
  readonly table: T
  readonly uses: U
}

interface DbMethods<T extends Tables, R extends SchemaRelations> {
  readonly $schema: Schema<T, R>
  /** Database that the `Db` is bound to. */
  readonly $database: Database
  /**
   * PostgreSQL schema of the tables, or `undefined` for a `Db` bound without `schemaName`.
   *
   * Reading it calls the function of `schemaName`, as compiling a query does, such as to resolve the schema of the current tenant.
   */
  readonly $schemaName: string | undefined
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
  // Independent of `T` and `R`, so that it is the same in every `Db`; like an awaited query, its query is checked when it runs.
  /**
   * Starts a query of one record whose fields are the values of the expressions and of the literals and the results of the queries of `selection`, selected in one statement when awaited.
   *
   * A query of `selection` is unbound or bound to this `Db`, and the value of its field is the result it gives when executed, such as an array of records or one value.
   */
  $select<Sel extends Selection>(selection: Sel): RecordQuery<SelectionState<Sel>, "bound">
  /**
   * Starts a query of the SQL statement of the template, which resolves to the number of the rows of its command tag when awaited, such as the rows that an `UPDATE` changes; `select`, `get`, and `pluck` return the fields of its rows instead.
   *
   * Interpolated values become query parameters, `sql` fragments and expressions stay SQL, a table of the `Db`, such as `db.form`, becomes its name, qualified by the PostgreSQL schema of the `Db`, and another query becomes a subquery, as in `sql`.
   */
  $query(strings: TemplateStringsArray, ...values: unknown[]): SqlQuery<InitialSqlQueryState>
  /**
   * Executes a script of statements without parameters, such as DDL separated by semicolons, in the ambient transaction or session, or on the pool outside of one; outside a transaction, PostgreSQL runs them in one implicit transaction.
   *
   * The script must not start or end transactions, which the database tracks.
   */
  $script(text: string): Promise<void>
  /**
   * Executes the script of the template as `$script` of its text does.
   *
   * It interpolates tables of the `Db`, such as `db.form`, and queries and `sql` fragments without parameters; it rejects values, since a script has no parameters.
   */
  $script(strings: TemplateStringsArray, ...values: unknown[]): Promise<void>
  /**
   * Runs `callback` in a transaction of the database, shared by every schema bound to it.
   *
   * Inside an existing transaction, it starts a nested transaction.
   */
  $transaction<Result>(
    callback: () => Promise<Result>,
    options?: TransactionOptions,
  ): Promise<Result>
  /**
   * Runs `callback` in the current transaction without a nested transaction, or in a new transaction of the database outside of one.
   *
   * A rejection of a callback that joined a transaction does not undo its changes: the enclosing transaction commits them unless it fails too.
   * A test transaction is not a transaction to join: there, it starts a nested transaction where it starts a transaction in production.
   */
  $ensureTransaction<Result>(callback: () => Promise<Result>): Promise<Result>
  /** Tells whether the code runs in a transaction of the database, not counting test transactions, so that code under test sees what it sees in production. */
  $isInTransaction(): boolean
  /**
   * Tells whether a statement of the code runs in a transaction block of PostgreSQL, counting test transactions, such as to choose a statement that PostgreSQL rejects there, `CREATE INDEX CONCURRENTLY`.
   *
   * It is `false` in a session outside its transactions.
   */
  $isInTransactionBlock(): boolean
  /**
   * Runs `callback` in a session of the database: on one connection outside a transaction, such as for statements that PostgreSQL rejects in a transaction block and that share a setting of the connection, such as its search path.
   *
   * Statements of every schema bound to the database join the session automatically, each in a transaction of its own, and `$transaction` in the callback starts a transaction on the connection of the session.
   * A rejection of `callback` undoes nothing.
   * It rejects inside a transaction, also a test transaction, inside another session, and on a database created with `test: true`.
   */
  $session<Result>(callback: () => Promise<Result>, options?: SessionOptions): Promise<Result>
  /**
   * Takes the advisory lock of `key` until the transaction of the database ends, waiting while another transaction or session holds it, such as to keep processes from running the same job at once.
   *
   * It rejects where `$isInTransaction()` is `false`, since outside a transaction the lock would end with its statement; in a session, take the lock with `$tryLock`, which does not wait.
   * A nested transaction that rolls back releases the locks it took.
   */
  $lock(key: string): Promise<void>
  /**
   * Takes the advisory lock of `key` unless another transaction or session holds it, and tells whether it took it, such as to skip a job that another process is running.
   *
   * In a transaction of the database, it holds the lock until the transaction ends, as `$lock` does; in a session outside its transactions, until the session ends.
   * It rejects outside both, since the lock would end with its statement; a test transaction alone does not count.
   */
  $tryLock(key: string): Promise<boolean>
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
  const resolveSchemaName = () => (typeof schemaName === "function" ? schemaName() : schemaName)

  function compile(query: DbQuery<T, R>): CompiledQuery {
    if (query.db !== undefined && query.db !== db) {
      throw new Error("Cannot run a query bound to another Db")
    }
    return compileStatement(
      lowerStatement(query.node, definitions, db),
      { schemaName: resolveSchemaName() },
      tables,
      db,
    )
  }

  const methods: DbMethods<T, R> = {
    $schema: schema,
    $database: database,
    get $schemaName() {
      return resolveSchemaName()
    },
    $compile(query) {
      const { text, parameters } = compile(query)
      return createStatement(text, parameters)
    },
    async $execute<Q extends DbQuery<T, R>>(query: Q) {
      const compiled = compile(query)
      if (compiled.locksRows && !database.isInTransaction()) {
        throw new Error(
          "Cannot lock the rows of a query outside a transaction, where the locks would end with its statement; a test transaction alone does not count",
        )
      }
      return decodeStatement(compiled, await database.execute(compiled)) as QueryResult<Q["types"]>
    },
    $select: selection => startRecordQuery(selection, db),
    $query: (strings, ...values) => startSqlQuery(toRawSqlNode(strings, values), db),
    async $script(script: string | TemplateStringsArray, ...values: unknown[]) {
      if (typeof script === "string") {
        return database.script(script)
      }
      const { text, parameters } = compile(startSqlQuery(toRawSqlNode(script, values), db))
      if (parameters.length > 0) {
        throw new Error(
          "A script has no parameters, so it takes no values, also in the queries and sql fragments that it interpolates",
        )
      }
      return database.script(text)
    },
    $transaction: (callback, options) => database.transaction(callback, options),
    $ensureTransaction: callback => database.ensureTransaction(callback),
    $isInTransaction: () => database.isInTransaction(),
    $isInTransactionBlock: () => database.isInTransactionBlock(),
    $session: (callback, options) => database.session(callback, options),
    $lock: key => database.lock(key),
    $tryLock: key => database.tryLock(key),
  }
  const contexts = createQueryContexts(Object.keys(schema.$tables), relations)
  const db: Db<T, R> = defineEntries(methods, schema.$tables, key =>
    bindQuery(startQuery(schema.$tables[key]!, contexts[key]!), db),
  )
  return db
}
