import type { TextValue } from "../../database/driver"
import type { ParameterBinder } from "../../database/sql/fragment"
import { bindParameter } from "../../database/sql/parameter"
import type { AnyDb } from "../../execution/db"
import type { AnyTable } from "../../table/table"

import { cutIdentifier, maxNameBytes } from "./identifier"

/**
 * State of one compilation shared by all queries of the statement, never by reusable nodes: parameters and the aliases of all sources.
 *
 * It binds the parameters of the fragments of the database layer that the statement interpolates, numbering them with its own.
 */
export class CompileContext implements ParameterBinder {
  readonly parameters: TextValue[] = []
  /** Whether a select statement of the compilation locks rows. */
  locksRows = false
  /** Whether the clauses being compiled belong to a query of groups, where `bindParam` binds the parameter of a cast once. */
  grouped = false
  readonly #aliases = new Set<string>()
  #placeholders: Map<object, string> | undefined

  constructor(
    readonly schemaName: string | undefined,
    /** Tables that the statement may use, or `undefined` for any table. */
    readonly tables: ReadonlySet<AnyTable> | undefined = undefined,
    /** `Db` that runs the statement, the only one whose interpolated tables it may name; `undefined` for a statement of no `Db`. */
    readonly db: AnyDb | undefined = undefined,
  ) {}

  /**
   * Creates an alias based on `name` that is unique in the statement, so that no source shadows another one in SQL.
   *
   * The name is cut to 50 bytes and numbered when the statement already has it, so an alias fits an identifier and PostgreSQL compares aliases as created rather than truncated.
   */
  createAlias(name: string): string {
    // The driver sends a lone surrogate as U+FFFD, so names that differ only by lone surrogates must not pass as different.
    const base = cutIdentifier(name.toWellFormed(), maxNameBytes)
    let alias = base
    for (let index = 2; this.#aliases.has(alias); index++) {
      alias = `${base}_${index}`
    }
    this.#aliases.add(alias)
    return alias
  }

  /** Adds a parameter of the statement and returns its placeholder, rejecting more parameters than PostgreSQL takes. */
  bind(value: TextValue): string {
    return bindParameter(this.parameters, value)
  }

  // PostgreSQL takes an expression of a query of groups, such as in `HAVING` or `ORDER BY`, for a key of `GROUP BY` only when it is equal to the key, so the query binds the parameter of a cast once, such as of `param(type, value)`, which is `$1::type` with the same type at every place.
  // A parameter without a cast takes its type from its place, so binding it once could convert its value by the type of another place, and a lookup of every parameter slows down statements of many parameters.
  /**
   * Binds `value` as the parameter of the cast that `key` identifies, such as its node, and returns its placeholder.
   *
   * In a query of groups, it binds the parameter unless it has bound it for `key` before.
   */
  bindParam(key: object, value: TextValue): string {
    if (!this.grouped) {
      return this.bind(value)
    }
    this.#placeholders ??= new Map()
    let placeholder = this.#placeholders.get(key)
    if (placeholder === undefined) {
      placeholder = this.bind(value)
      this.#placeholders.set(key, placeholder)
    }
    return placeholder
  }
}
