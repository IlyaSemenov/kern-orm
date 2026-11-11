import type { MigrationStep } from "../migration"
import { quoteIdentifier } from "../sql"

import { invertStep } from "./step"

/**
 * Options of `createSequence` and `dropSequence`.
 *
 * Each number is a safe integer as a `number`, or any integer as a `bigint`.
 */
export interface SequenceOptions {
  /** Type of the values. */
  type?: "smallint" | "integer" | "bigint"
  /** Value added to the current value to get the next one, negative for a descending sequence. */
  increment?: number | bigint
  minValue?: number | bigint
  maxValue?: number | bigint
  start?: number | bigint
  /** Number of values that a session allocates in advance. */
  cache?: number | bigint
  /** Wraps around to the minimum value after the maximum, or to the maximum after the minimum for a descending sequence, instead of failing. */
  cycle?: boolean
}

// Numeric options with the clauses that set them, in the order that `createSequence` writes them.
const numericClauses = [
  ["increment", "INCREMENT BY"],
  ["minValue", "MINVALUE"],
  ["maxValue", "MAXVALUE"],
  ["start", "START WITH"],
  ["cache", "CACHE"],
] as const

/**
 * Builds a step that creates a sequence, and drops it on rollback.
 *
 * It throws for a numeric option that is a `number` but not a safe integer.
 */
export function createSequence(name: string, options: SequenceOptions = {}): MigrationStep {
  const describe = describeProblem("create", name)
  const quotedName = quoteIdentifier(name)
  let definition = quotedName
  if (options.type !== undefined) {
    definition += ` AS ${options.type}`
  }
  for (const [option, clause] of numericClauses) {
    const value = options[option]
    if (value !== undefined) {
      definition += ` ${formatClause(clause, option, value, describe)}`
    }
  }
  if (options.cycle) {
    definition += " CYCLE"
  }
  return {
    up: `CREATE SEQUENCE ${definition}`,
    down: `DROP SEQUENCE ${quotedName}`,
  }
}

/**
 * Builds a step that drops a sequence, and creates it again on rollback as `createSequence` of the same arguments does.
 *
 * Rollback starts the sequence again from `start` rather than restoring its current value.
 */
export function dropSequence(name: string, options: SequenceOptions = {}): MigrationStep {
  return invertStep(createSequence(name, options))
}

/** Builds a step that renames a sequence, and renames it back on rollback. */
export function renameSequence(from: string, to: string): MigrationStep {
  return {
    up: `ALTER SEQUENCE ${quoteIdentifier(from)} RENAME TO ${quoteIdentifier(to)}`,
    down: `ALTER SEQUENCE ${quoteIdentifier(to)} RENAME TO ${quoteIdentifier(from)}`,
  }
}

/**
 * State of a sequence that `changeSequence` changes from or to: the options of `createSequence` that change, each given in both states.
 *
 * `minValue` and `maxValue` of `null` are the defaults: the bounds of the type, with a minimum of 1 for an ascending sequence and a maximum of -1 for a descending one.
 */
export interface SequenceState extends Omit<SequenceOptions, "minValue" | "maxValue"> {
  minValue?: number | bigint | null
  maxValue?: number | bigint | null
}

// Properties of a state that the states of a change list together, so that a missing one never means a value.
const listedProperties = [
  "type",
  "increment",
  "minValue",
  "maxValue",
  "start",
  "cache",
  "cycle",
] as const

/**
 * Builds a step that changes the options of a sequence from state `from` to state `to`, and changes them back on rollback.
 *
 * A property that changes must be in both states.
 * A change of `type` or of the sign of `increment` requires `minValue` and `maxValue`, which the step sets.
 * A change of `type` requires them as numbers rather than `null`.
 * `start` changes only the value that a restart of the sequence begins from, not its current value.
 * It throws when the states change nothing, and for a numeric option that is a `number` but not a safe integer.
 */
export function changeSequence(
  name: string,
  from: SequenceState,
  to: SequenceState,
): MigrationStep {
  const describe = describeProblem("change", name)
  for (const property of listedProperties) {
    if ((from[property] === undefined) !== (to[property] === undefined)) {
      throw describe(`give ${property} in both states or in neither`)
    }
  }
  // PostgreSQL derives the default bounds from the type and the direction, and replaces a bound equal to a limit of the old type with that of the new one, so rollback restores the bounds only when the step sets them.
  const setsBounds =
    from.type !== to.type || isDescending(from.increment) !== isDescending(to.increment)
  if (setsBounds && (from.minValue === undefined || from.maxValue === undefined)) {
    throw describe("give minValue and maxValue to change type or the sign of increment")
  }
  // When `AS` changes the type, `NO MINVALUE` and `NO MAXVALUE` can give the limits of the new type whatever the direction, such as to the minimum of an ascending sequence; numeric bounds avoid it.
  if (
    from.type !== to.type &&
    (from.minValue === null ||
      from.maxValue === null ||
      to.minValue === null ||
      to.maxValue === null)
  ) {
    throw describe("give minValue and maxValue as numbers to change type")
  }
  const upActions = getAlterActions(from, to, setsBounds, describe)
  if (upActions === "") {
    throw describe("the states change nothing")
  }
  const quotedName = quoteIdentifier(name)
  return {
    up: `ALTER SEQUENCE ${quotedName}${upActions}`,
    down: `ALTER SEQUENCE ${quotedName}${getAlterActions(to, from, setsBounds, describe)}`,
  }
}

/**
 * Builds the clauses of `ALTER SEQUENCE` that change a sequence from state `from` to state `to`, each after a space, in the order that `createSequence` writes them.
 *
 * With `setsBounds`, it sets `minValue` and `maxValue` also when they do not differ.
 */
function getAlterActions(
  from: SequenceState,
  to: SequenceState,
  setsBounds: boolean,
  describe: (problem: string) => Error,
): string {
  let actions = ""
  if (from.type !== to.type) {
    actions += ` AS ${to.type}`
  }
  for (const [option, clause] of numericClauses) {
    const before = from[option]
    const after = to[option]
    if (after === undefined || before === undefined) {
      continue
    }
    const action = formatClause(clause, option, after, describe)
    if (
      action !== formatClause(clause, option, before, describe) ||
      (setsBounds && (option === "minValue" || option === "maxValue"))
    ) {
      actions += ` ${action}`
    }
  }
  if (from.cycle !== to.cycle) {
    actions += to.cycle ? " CYCLE" : " NO CYCLE"
  }
  return actions
}

/** Tells whether an increment makes a sequence descending. */
function isDescending(increment: number | bigint | undefined): boolean {
  return increment !== undefined && increment < 0
}

/** Creates the function that builds the error of a problem with the arguments of a helper of sequence `name`. */
function describeProblem(action: string, name: string): (problem: string) => Error {
  return problem => new Error(`Cannot ${action} sequence ${name}: ${problem}`)
}

/** Builds the clause of a numeric option, `NO <clause>` for `null`, throwing for a `number` that is not a safe integer. */
function formatClause(
  clause: string,
  option: string,
  value: number | bigint | null,
  describe: (problem: string) => Error,
): string {
  if (value === null) {
    return `NO ${clause}`
  }
  // A `number` beyond the safe integers may differ from the integer that the code wrote, so a larger value requires a `bigint`.
  if (typeof value === "number" && !Number.isSafeInteger(value)) {
    throw describe(`${option} must be a safe integer or a bigint, got ${value}`)
  }
  return `${clause} ${value}`
}
