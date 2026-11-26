/** Direction of a migration: `up` applies it, and `down` rolls it back. */
export type MigrationDirection = "up" | "down"

/** Error of a migration or of the baseline of a history: of loading its module, or of a step that failed, with the original error in `cause`. */
export class MigrationError extends Error {
  override readonly name = "MigrationError"
  /** Key of the migration, or `undefined` for the baseline of a history, which has no key. */
  readonly key: string | undefined
  /** Number of the step, from 1, or `undefined` for an error of the migration as a whole, such as of loading its module. */
  readonly step: number | undefined
  /** Direction of the step that failed, or `undefined` for an error of the migration as a whole or of a step that is not valid. */
  readonly direction: MigrationDirection | undefined

  constructor(
    message: string,
    details: {
      key: string | undefined
      step?: number
      direction?: MigrationDirection
      cause?: unknown
    },
  ) {
    super(message, details.cause === undefined ? undefined : { cause: details.cause })
    this.key = details.key
    this.step = details.step
    this.direction = details.direction
  }
}

/**
 * Returns how a message names the migration of `key`, such as `migration 0001_create_form`, or `the baseline` for the baseline of a history, which has no key.
 *
 * `capitalized` gives the name that starts a sentence, such as `The baseline`.
 */
export function nameMigration(key: string | undefined, capitalized = false): string {
  if (key === undefined) {
    return capitalized ? "The baseline" : "the baseline"
  }
  return `${capitalized ? "Migration" : "migration"} ${key}`
}

/** Returns the message of an `Error`, or the text of another thrown value. */
export function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
