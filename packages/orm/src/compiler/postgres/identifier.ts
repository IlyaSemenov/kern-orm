// PostgreSQL identifiers that the compiler generates: the length of a name kept in one, and the names of projections.

import { cutIdentifier, maxCharacterBytes } from "kern-db/builder"

/**
 * Most bytes of a name kept whole in a generated identifier.
 *
 * It leaves room for `_` and a number in the 63 bytes of an identifier, since PostgreSQL truncates a longer one ([PostgreSQL](https://www.postgresql.org/docs/current/sql-syntax-lexical.html#SQL-SYNTAX-IDENTIFIERS)).
 */
export const maxNameBytes = 50

/**
 * Returns the SQL name of the projection with `key` at `index` of its query.
 *
 * A key of up to 50 bytes is the name itself.
 * A longer key is named by its prefix of at most 54 bytes, which takes more than 50 since a character takes at most 4, and by its position, so the name differs from the names of the other projections.
 */
export function nameProjection(key: string, index: number): string {
  if (cutIdentifier(key, maxNameBytes).length === key.length) {
    return key
  }
  return `${cutIdentifier(key, maxNameBytes + maxCharacterBytes)}_${index + 1}`
}
