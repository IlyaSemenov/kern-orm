import type { AnyTable } from "../../table/table"
import type { TextValue } from "../../type/type"

import { cutIdentifier, maxNameBytes } from "./identifier"

/** State of one compilation shared by all queries of the statement, never by reusable nodes: parameters and the aliases of all sources. */
export class CompileContext {
  readonly parameters: TextValue[] = []
  readonly #aliases = new Set<string>()

  constructor(
    readonly schemaName: string | undefined,
    /** Tables that the statement may use, or `undefined` for any table. */
    readonly tables: ReadonlySet<AnyTable> | undefined = undefined,
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

  bind(value: TextValue): string {
    this.parameters.push(value)
    return `$${this.parameters.length}`
  }
}
