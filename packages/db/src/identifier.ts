// PostgreSQL identifiers: quoting, and the length that PostgreSQL keeps.

/** Quotes `name` as a PostgreSQL identifier, which keeps its case and any characters in it. */
export function quoteIdentifier(name: string): string {
  return `"${name.replaceAll('"', '""')}"`
}

/** Most bytes of an identifier that PostgreSQL keeps; it truncates a longer one ([PostgreSQL](https://www.postgresql.org/docs/current/sql-syntax-lexical.html#SQL-SYNTAX-IDENTIFIERS)). */
export const maxIdentifierBytes = 63

/** Most bytes a character other than ASCII takes in a server encoding, such as UTF-8 and EUC_TW ([PostgreSQL](https://www.postgresql.org/docs/current/multibyte.html)). */
export const maxCharacterBytes = 4

/**
 * Returns the longest prefix of `name` that takes at most `maxBytes` bytes counted as one byte for an ASCII character and 4 for any other, the most that a server encoding takes, so that it fits `maxBytes` in any server encoding.
 *
 * A server encoding that takes fewer bytes for a character may fit a longer prefix.
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
