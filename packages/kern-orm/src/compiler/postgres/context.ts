import type { AnyDb } from "../../execution/db"
import type { AnyTable } from "../../table/table"
import type { TextValue } from "../../type/type"

import { cutIdentifier, maxNameBytes } from "./identifier"

// The protocol of PostgreSQL counts the parameters of a statement in 16 bits.
/** Most parameters that PostgreSQL takes in a statement. */
export const maxParameters = 65535

/** State of one compilation shared by all queries of the statement, never by reusable nodes: parameters and the aliases of all sources. */
export class CompileContext {
  readonly parameters: TextValue[] = []
  /** Whether a select statement of the compilation locks rows. */
  locksRows = false
  readonly #aliases = new Set<string>()

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
    if (this.parameters.length === maxParameters) {
      throw new Error(
        `Statement has more than ${maxParameters} parameters, which PostgreSQL does not take; split it into several statements, such as in a transaction`,
      )
    }
    this.parameters.push(value)
    return `$${this.parameters.length}`
  }
}
