// Run-time parameters of PostgreSQL that a level sets until it ends, such as the search path of a transaction.

import { quoteIdentifier } from "../../compiler/postgres/identifier"
import type { TextValue } from "../../type/type"
import type { TransactionOptions } from "../database"
import type { SqlStatement } from "../driver"
import { createStatement } from "../driver"

import type { TransactionLevel } from "./level"

/** Run-time parameter of PostgreSQL that a level sets until it ends, with its value. */
export interface LevelSetting {
  readonly name: string
  readonly value: TextValue
}

/** Settings of a level of `transaction` with `options`, or `undefined` when it has none. */
export function getLevelSettings(
  options: TransactionOptions | undefined,
): LevelSetting[] | undefined {
  // The value of `search_path` is a list of identifiers, so each schema is quoted, as the PostgreSQL schema of a Db is, which keeps the case of its name and lets it contain commas and quotes.
  return options?.searchPath
    ? [{ name: "search_path", value: options.searchPath.map(quoteIdentifier).join(", ") }]
    : undefined
}

/**
 * Applies `settings` to a level whose `BEGIN` or `SAVEPOINT` completed, unless its cleanup has started.
 *
 * A nested level first reads the values they replace, which it restores before its `RELEASE`: PostgreSQL keeps a setting of a released savepoint until the transaction ends, while `ROLLBACK TO` restores it itself.
 */
export async function applySettings(
  level: TransactionLevel,
  settings: readonly LevelSetting[],
): Promise<void> {
  // Whoever ends a starting level, such as its enclosing level or the abort of a test, queues its rollback behind the running statement, so a later statement would run after the rollback, or on a connection already released.
  if (level.cleanup) {
    return
  }
  if (level.parent) {
    // A statement of its own reads the values before they change, since PostgreSQL does not define the order in which it evaluates the expressions of one statement.
    let text = "SELECT"
    const names: string[] = []
    for (const { name } of settings) {
      names.push(name)
      text += `${names.length > 1 ? "," : ""} current_setting($${names.length})`
    }
    const values = (await level.connection.execute(createStatement(text, names))).rows[0]!
    level.restore = createSettingStatement(
      settings.map(({ name }, index) => ({ name, value: values[index]! })),
    )
    if (level.cleanup) {
      return
    }
  }
  await level.connection.execute(createSettingStatement(settings))
}

/** Creates the statement that sets `settings` until the transaction ends or rolls back to an earlier savepoint, as `SET LOCAL` does. */
function createSettingStatement(settings: readonly LevelSetting[]): SqlStatement {
  let text = "SELECT"
  const parameters: TextValue[] = []
  for (const { name, value } of settings) {
    parameters.push(name, value)
    text += `${parameters.length > 2 ? "," : ""} set_config($${parameters.length - 1}, $${parameters.length}, true)`
  }
  return createStatement(text, parameters)
}
