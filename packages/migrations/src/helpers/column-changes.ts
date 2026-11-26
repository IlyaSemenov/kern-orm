import { endLineComment, quoteIdentifier } from "../sql"

/** State of a column that `changeColumn` and `changeColumns` change from or to: the properties that change, each of `type`, `notNull`, and `default` that one state gives also given in the other. */
export interface ColumnState {
  /** SQL type, such as `"integer"`. */
  type?: string
  /** SQL expression that converts the values of the column to `type`, such as `"position::integer"`, for a change to this state. */
  using?: string
  notNull?: boolean
  /** SQL expression of the default, such as `"0"`, or `null` for no default. */
  default?: string | null
}

/** Change of a column that `changeColumns` and `alterTable` make: its state before and after the change. */
export type ColumnChange = readonly [from: ColumnState, to: ColumnState]

// Properties of a state that the states of a change list together, so that a missing one never means a value.
const listedProperties = ["type", "notNull", "default"] as const

/** Throws when only one state of a change of a column gives `type`, `notNull`, or `default`, when a state gives `using` without a change of type, or when the states change nothing. */
export function checkColumnChange(
  table: string,
  column: string,
  from: ColumnState,
  to: ColumnState,
): void {
  const describe = (problem: string) =>
    new Error(`Cannot change column ${column} of table ${table}: ${problem}`)
  for (const property of listedProperties) {
    if ((from[property] === undefined) !== (to[property] === undefined)) {
      throw describe(`give ${property} in both states or in neither`)
    }
  }
  const typeChanges = from.type !== to.type
  if (!typeChanges && (from.using !== undefined || to.using !== undefined)) {
    throw describe("using requires a change of type")
  }
  if (!typeChanges && from.notNull === to.notNull && from.default === to.default) {
    throw describe("the states change nothing")
  }
}

/** Appends to `actions` the `ALTER COLUMN` actions of `ALTER TABLE` that change a column from state `from` to state `to`. */
export function pushColumnActions(
  actions: string[],
  column: string,
  from: ColumnState,
  to: ColumnState,
): void {
  const typeChanges = from.type !== to.type
  const name = quoteIdentifier(column)
  // PostgreSQL casts the default to the new type unless it is dropped first, which fails for a default such as `''` of a text column that becomes integer.
  if (from.default !== undefined && from.default !== null && (to.default === null || typeChanges)) {
    actions.push(`ALTER COLUMN ${name} DROP DEFAULT`)
  }
  if (typeChanges) {
    // `USING` follows the type on its line, so a line comment at the end of the type would comment it out.
    actions.push(
      to.using === undefined
        ? `ALTER COLUMN ${name} TYPE ${to.type}`
        : `ALTER COLUMN ${name} TYPE ${endLineComment(to.type!)} USING ${to.using}`,
    )
  }
  if (from.notNull !== to.notNull) {
    actions.push(`ALTER COLUMN ${name} ${to.notNull ? "SET NOT NULL" : "DROP NOT NULL"}`)
  }
  if (
    to.default !== undefined &&
    to.default !== null &&
    (to.default !== from.default || typeChanges)
  ) {
    actions.push(`ALTER COLUMN ${name} SET DEFAULT ${to.default}`)
  }
}
