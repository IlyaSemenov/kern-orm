// Conversions of results: `map` and `transform` of a query, whose result code converts after decoding, with the SQL of that query.

import { types } from "node:util"

import type { CompileOptions } from "../compiler/postgres/compile"
import type { SqlStatement } from "../database/driver"
import type { AnyDb } from "../execution/db"
import { operandNode } from "../expression/expression"
import type { ResultConversion } from "../result/result"
import type { UsedRelation } from "../schema/relation"
import type { AnyTable } from "../table/table"
import type { IsAny } from "../utils/type-helpers"

import type { QueryDb, QueryThen, SelectQueryKind, ToSQLArgs } from "./kind"
import { compileToSQL, executeOnAwait } from "./kind"
import type { QueryNode } from "./node"
import type { QueryResult } from "./rows"
import type { QueryState } from "./state"

/** Type that the result of a callback of `transform` and `map` is checked against when it may be a Promise. */
export interface NotSynchronous {
  readonly "the callback must return its result synchronously": never
}

// Decoding is synchronous, so nothing would wait for a Promise in a field of nested rows, and `then` and `$execute` would need to type each result by what `await` makes of it.
/** Check of `R`, the result of a callback of `transform` and `map`: it fails against `NotSynchronous` when `R` may be a Promise, such as a union with one, but not for `any` and `unknown`. */
export type SynchronousResult<R> = [Extract<R, PromiseLike<unknown>>] extends [never]
  ? unknown
  : IsAny<R> extends true
    ? unknown
    : NotSynchronous

/** State of a query of `transform` of a table in types: over table `T`, whose whole result is `R`, selecting records of relations `U`. */
export interface TransformedQueryState<
  T extends AnyTable = AnyTable,
  R = unknown,
  U extends UsedRelation = UsedRelation,
> extends QueryState {
  readonly table: T
  readonly result: R
  readonly rows: "one"
  readonly value: "transformed"
  readonly uses: U
}

/**
 * Immutable query of a table of state `S` whose whole result `transform` converts after decoding, unbound or bound to a `Db`.
 *
 * It executes and nests in a selection as the query it comes from, with the same SQL, so it has only `transform`, which converts the result further: another method would change what the callback receives, and an expression does not take it, since SQL does not see the conversion.
 * An unbound query is not thenable, so it can be returned from async functions; it is compiled with `toSQL` or executed by a `Db`.
 * A bound query executes on its `Db` when awaited.
 */
// Like `SelectQuery`, it is covariant in its state and its kind, so that a `Db` executes it whatever its state.
export class TransformedQuery<
  out S extends TransformedQueryState,
  out Kind extends SelectQueryKind = "unbound",
> {
  declare readonly types: S
  /** Marks a query of `transform`, for types only, so that TypeScript rejects a query of a table as one by this member, without comparing their states. */
  declare readonly transformed: true
  /** `Db` that executes the query when it is awaited; `undefined` for an unbound query. */
  readonly db: QueryDb<Kind>
  /** Executes a bound query on its `Db`; `undefined` for an unbound query, so that it is not thenable. */
  // oxlint-disable-next-line unicorn/no-thenable -- awaiting a bound query executes it; unbound queries are not thenable
  readonly then: QueryThen<S, Kind>

  constructor(
    readonly node: QueryNode,
    db?: AnyDb,
  ) {
    this.db = db as QueryDb<Kind>
    // oxlint-disable-next-line unicorn/no-thenable -- only a bound query gets a function
    this.then = (db === undefined ? undefined : executeOnAwait) as QueryThen<S, Kind>
    Object.freeze(this)
  }

  /** Converts the whole result further, after the earlier conversions; see `transform` of a query of a table. */
  transform<S extends TransformedQueryState, Kind extends SelectQueryKind, R>(
    this: TransformedQuery<S, Kind>,
    callback: (result: QueryResult<S>) => R & SynchronousResult<R>,
  ): TransformedQuery<TransformedQueryState<S["table"], R, S["uses"]>, Kind>
  transform(callback: (result: unknown) => unknown): unknown {
    return transformQuery(this.node, this.db as AnyDb | undefined, callback)
  }

  /**
   * Compiles the query into SQL text and parameters; `schemaName` qualifies its tables.
   *
   * A query bound to a `Db` compiles as the `Db` executes it, with the PostgreSQL schema of the `Db`, and rejects options.
   */
  toSQL(...args: ToSQLArgs<Kind>): SqlStatement
  toSQL(options?: CompileOptions): SqlStatement {
    return compileToSQL(this, options)
  }

  /** Rejects the query as an operand of an expression, whose value SQL reads without its conversion. */
  [operandNode](): never {
    throw new TypeError(
      "An expression takes a query of one value of a table, such as of get, an aggregate, or exists, not a query of transform",
    )
  }
}

/** Query of `transform` of a table of any state and kind. */
// oxlint-disable-next-line typescript/no-explicit-any -- any such query regardless of its result
export type AnyTransformedQuery = TransformedQuery<any, SelectQueryKind>

/** Creates the query of `transform` of `node`, a query of a table bound to `db` when given, whose whole result `callback` converts after the earlier conversions. */
export function transformQuery(
  node: QueryNode,
  db: AnyDb | undefined,
  callback: (result: unknown) => unknown,
): AnyTransformedQuery {
  return new TransformedQuery(
    Object.freeze({
      ...node,
      conversion: addTransform(node.conversion, callback),
      foundKey: undefined,
    }),
    db,
  )
}

/**
 * Returns `conversion` of a query with `callback` of `map` after its earlier one.
 *
 * It rejects a conversion of `transform`, whose result has no rows to convert.
 */
export function addMap(
  conversion: ResultConversion | undefined,
  callback: (row: unknown) => unknown,
): ResultConversion {
  if (conversion?.transform !== undefined) {
    throw new Error("map cannot be used after transform; convert the rows in its callback instead")
  }
  return Object.freeze({
    map: chainConversions(conversion?.map, createConversion(callback, "map")),
    transform: undefined,
  })
}

/** Returns `conversion` of a query with `callback` of `transform` after its earlier one. */
export function addTransform(
  conversion: ResultConversion | undefined,
  callback: (result: unknown) => unknown,
): ResultConversion {
  return Object.freeze({
    map: conversion?.map,
    transform: chainConversions(conversion?.transform, createConversion(callback, "transform")),
  })
}

/** Returns the conversion that applies `next` after `previous`, if any. */
function chainConversions(
  previous: ((value: unknown) => unknown) | undefined,
  next: (value: unknown) => unknown,
): (value: unknown) => unknown {
  return previous === undefined ? next : value => next(previous(value))
}

/**
 * Creates the conversion of `callback` of `method`, which rejects a Promise or another thenable returned by the callback: `SynchronousResult` rejects it in types, and a callback may still return one through `any`.
 *
 * It rejects a `callback` that is not a function when it is called, since decoding calls it long after, where its error would read as a failure of a row.
 */
function createConversion(
  callback: (value: unknown) => unknown,
  method: string,
): (value: unknown) => unknown {
  if (typeof callback !== "function") {
    throw new TypeError(`${method} takes a callback`)
  }
  return value => {
    const result = callback(value)
    if (typeof (result as { then?: unknown } | null | undefined)?.then === "function") {
      // The query fails here, so a rejection of the Promise would reach no code, and end the process as an unhandled rejection.
      // Only a Promise, of any realm: calling `then` of another value, such as a bound query, could execute it.
      if (types.isPromise(result)) {
        result.catch(ignoreRejection)
      }
      throw new TypeError(
        `The callback of ${method} must return its result synchronously, not a Promise or a query`,
      )
    }
    return result
  }
}

/** Handles the rejection of a Promise that a callback returned, whose query has failed already. */
function ignoreRejection(): void {}
