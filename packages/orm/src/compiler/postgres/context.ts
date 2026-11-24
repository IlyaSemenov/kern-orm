import type { TextValue } from "kern-db"
import type { ParameterBinder } from "kern-db/builder"
import { bindParameter, cutIdentifier } from "kern-db/builder"

import type { AnyDb } from "../../execution/db"
import type { AnyRowSource } from "../../table/table"

import { maxNameBytes } from "./identifier"

/**
 * State of one compilation shared by all queries of the statement, never by reusable nodes: parameters and the aliases of all sources.
 *
 * It binds the parameters of the fragments of the database layer that the statement interpolates, numbering them with its own.
 */
export class CompileContext implements ParameterBinder {
  readonly parameters: TextValue[] = []
  /** Whether a select statement of the compilation locks rows. */
  locksRows = false
  readonly #aliases = new Set<string>()
  #firstKey: object | undefined
  #firstPlaceholder = ""
  #placeholders: Map<object, string> | undefined

  constructor(
    readonly schemaName: string | undefined,
    /** Tables that the statement may use, or `undefined` for any table. */
    readonly tables: ReadonlySet<AnyRowSource> | undefined = undefined,
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

  // A cast, such as of `param(type, value)`, types its parameter the same at every place, so a statement binds it once, as `compileFragment` of the database layer does: a key of `GROUP BY` that a query of groups repeats in `HAVING` or `ORDER BY` compiles to equal text, which PostgreSQL requires, when all its parameters are such casts.
  // A parameter without a cast takes its type from its place, so binding it once could convert its value by the type of another place, and a lookup of every parameter slows down statements of many parameters.
  /** Binds `value` as the parameter of the cast that `key` identifies, such as its node, unless it has bound it for `key` before, and returns its placeholder. */
  bindParam(key: object, value: TextValue): string {
    if (key === this.#firstKey) {
      return this.#firstPlaceholder
    }
    // The first cast is kept apart and the map is created at the second one, so that a statement of one cast pays nothing for the map.
    if (this.#firstKey === undefined) {
      this.#firstKey = key
      this.#firstPlaceholder = this.bind(value)
      return this.#firstPlaceholder
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
