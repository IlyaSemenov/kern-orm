// PostgreSQL identifiers: quoting and the length limit.

/** Most bytes a character other than ASCII takes in a server encoding, such as UTF-8 and EUC_TW ([PostgreSQL](https://www.postgresql.org/docs/current/multibyte.html)). */
const maxCharacterBytes = 4

/**
 * Most bytes of a name kept whole in a generated identifier.
 *
 * It leaves room for `_` and a number in the 63 bytes of an identifier, since PostgreSQL truncates a longer one ([PostgreSQL](https://www.postgresql.org/docs/current/sql-syntax-lexical.html#SQL-SYNTAX-IDENTIFIERS)).
 */
export const maxNameBytes = 50

export function quoteIdentifier(name: string): string {
  return `"${name.replaceAll('"', '""')}"`
}

/**
 * Returns the longest prefix of `name` that takes at most `maxBytes` bytes in any server encoding.
 *
 * Every server encoding takes one byte for an ASCII character, and a character other than ASCII counts as the most bytes it can take.
 */
export function cutIdentifier(name: string, maxBytes: number): string {
  // A UTF-16 code unit is at most one character, so a short name fits without counting.
  if (name.length * maxCharacterBytes <= maxBytes) {
    return name
  }
  let bytes = 0
  for (let index = 0; index < name.length;) {
    const code = name.codePointAt(index)!
    bytes += code < 0x80 ? 1 : maxCharacterBytes
    if (bytes > maxBytes) {
      return name.slice(0, index)
    }
    // A surrogate pair is one character, so the prefix never splits it.
    index += code < 0x10000 ? 1 : 2
  }
  return name
}

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
