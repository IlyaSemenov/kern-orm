import type { MigrationStep } from "../migration"
import { quoteIdentifier, quoteLiteral } from "../sql"

import { invertStep } from "./step"

/**
 * Builds a step that creates an enum type of `values` in their order, and drops it on rollback.
 *
 * `values` are the labels of the type as they are, which the step quotes.
 */
export function createEnum(name: string, values: readonly string[]): MigrationStep {
  const quotedName = quoteIdentifier(name)
  let labels = ""
  for (const value of values) {
    labels += labels === "" ? quoteLiteral(value) : `, ${quoteLiteral(value)}`
  }
  return {
    up: `CREATE TYPE ${quotedName} AS ENUM (${labels})`,
    down: `DROP TYPE ${quotedName}`,
  }
}

/** Builds a step that drops an enum type, and creates it again on rollback as `createEnum` of the same arguments does. */
export function dropEnum(name: string, values: readonly string[]): MigrationStep {
  return invertStep(createEnum(name, values))
}
