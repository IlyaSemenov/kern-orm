// Run-time parameters of PostgreSQL that a level sets until it ends, such as the search path of a transaction or of a session.

import type { TransactionOptions } from "../database"
import type { SqlStatement, TextValue } from "../driver"
import { createStatement } from "../driver"
import { quoteIdentifier } from "../identifier"

import type { TransactionLevel } from "./level"

/** Run-time parameter of PostgreSQL that a level sets until it ends, with its value. */
export interface LevelSetting {
  readonly name: string
  readonly value: TextValue
}

/** Largest `lock_timeout` that PostgreSQL accepts, in milliseconds: the largest signed 32-bit integer, which is the type of its value. */
const maxLockTimeout = 2 ** 31 - 1

/**
 * Settings of a level of `transaction` or of `session` with `options`, or `undefined` when it has none.
 *
 * It throws for an invalid `lockTimeout`, so that the level sends no statement.
 */
export function getLevelSettings(
  options: Pick<TransactionOptions, "searchPath" | "lockTimeout"> | undefined,
): LevelSetting[] | undefined {
  if (!options) {
    return undefined
  }
  const settings: LevelSetting[] = []
  if (options.searchPath) {
    // The value of `search_path` is a list of identifiers, so each schema is quoted, as the PostgreSQL schema of a Db is, which keeps the case of its name and lets it contain commas and quotes.
    settings.push({
      name: "search_path",
      value: options.searchPath.map(quoteIdentifier).join(", "),
    })
  }
  if (options.lockTimeout !== undefined) {
    settings.push({ name: "lock_timeout", value: formatLockTimeout(options.lockTimeout) })
  }
  return settings.length > 0 ? settings : undefined
}

/**
 * Returns the value of `lock_timeout` for `milliseconds`, an integer from 0, which disables the timeout, to the largest value that PostgreSQL accepts.
 *
 * It throws a `RangeError` for another number, which PostgreSQL would reject or round, and for a value that is not a number, such as of code without types.
 */
function formatLockTimeout(milliseconds: number): string {
  if (!Number.isInteger(milliseconds) || milliseconds < 0 || milliseconds > maxLockTimeout) {
    throw new RangeError(
      // A value that is not a number names its type, since converting it to a string can throw, such as for an object without a prototype.
      `lockTimeout must be an integer number of milliseconds from 0 to ${maxLockTimeout}, got ${typeof milliseconds === "number" ? milliseconds : typeof milliseconds}`,
    )
  }
  // A value without a unit is in milliseconds, the unit of `lock_timeout`.
  return String(milliseconds)
}

/**
 * Applies `settings` to a level whose `BEGIN` or `SAVEPOINT` completed, or to a session, unless its cleanup has started.
 *
 * A savepoint first reads the values they replace, which it restores before its `RELEASE`: PostgreSQL keeps a setting of a released savepoint until the transaction ends, while `ROLLBACK TO` restores it itself.
 * A session reads them too, and sets its settings for the whole session of PostgreSQL, since it has no transaction that would end them; the coordinator restores them before it releases the connection.
 */
export async function applySettings(
  level: TransactionLevel,
  settings: readonly LevelSetting[],
): Promise<void> {
  // Whoever ends a starting level, such as its enclosing level or the abort of a test, queues its rollback behind the running statement, so a later statement would run after the rollback, or on a connection already released.
  if (level.cleanup) {
    return
  }
  const local = !level.session
  if (level.session || level.savepoint) {
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
      local,
    )
    if (level.cleanup) {
      return
    }
  }
  await level.connection.execute(createSettingStatement(settings, local))
}

/** Creates the statement that sets `settings`: when `local`, until the transaction ends or rolls back to an earlier savepoint, as `SET LOCAL` does, and otherwise for the session of PostgreSQL, as `SET` does. */
function createSettingStatement(settings: readonly LevelSetting[], local: boolean): SqlStatement {
  let text = "SELECT"
  const parameters: TextValue[] = []
  for (const { name, value } of settings) {
    parameters.push(name, value)
    text += `${parameters.length > 2 ? "," : ""} set_config($${parameters.length - 1}, $${parameters.length}, ${local})`
  }
  return createStatement(text, parameters)
}
