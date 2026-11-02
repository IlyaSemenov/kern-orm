/**
 * Quotes a PostgreSQL identifier, such as the name of a schema or a table, so that it keeps its case and characters.
 *
 * It throws for an empty name, which PostgreSQL rejects, so that a helper with a name left blank fails when its migration loads rather than when it runs.
 */
export function quoteIdentifier(name: string): string {
  if (name === "") {
    throw new Error("Cannot quote an empty name")
  }
  return `"${name.replaceAll('"', '""')}"`
}

/**
 * Quotes a string as a PostgreSQL string literal, as `quote_literal` of PostgreSQL does.
 *
 * It doubles quotes and backslashes, and prefixes `E` to a literal with a backslash, so that the literal keeps its value whatever `standard_conforming_strings` is.
 */
export function quoteLiteral(value: string): string {
  const quoted = `'${value.replaceAll("'", "''").replaceAll("\\", "\\\\")}'`
  return value.includes("\\") ? `E${quoted}` : quoted
}

/**
 * Quotes `body` as a dollar-quoted string constant, such as the body of a `DO` block.
 *
 * Its tag is the first of `$$`, `$_$`, `$__$`, and so on that `body` does not contain, so that `body` cannot end the constant; `body` must neither start nor end with `$`.
 */
export function quoteDollar(body: string): string {
  let tag = "$$"
  while (body.includes(tag)) {
    tag = `$${"_".repeat(tag.length - 1)}$`
  }
  return `${tag}${body}${tag}`
}
