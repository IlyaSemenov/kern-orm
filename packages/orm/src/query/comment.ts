// Labels of `comment` of queries.

// The compiler writes the label between `/* ` and ` */`, so a label that ends with `*`, `/`, or `-` stays inside the comment.
/**
 * Checks the label of `comment` of a query and returns it, or `undefined` for `null`, which removes the comment.
 *
 * It rejects a value other than a string or `null`: `undefined` could remove the comment by mistake, and SQL would receive another value, such as an array, as the string it converts to.
 * It rejects a string that would not stay inside the comment of the statement:
 *
 * - with the end of a block comment, which would end the comment early;
 * - with the start of one, which PostgreSQL nests as a comment of its own, whose end would leave the outer comment open over the statement;
 * - with a NUL character, which PostgreSQL rejects in the text of a statement.
 */
export function createComment(label: unknown): string | undefined {
  if (label === null) {
    return undefined
  }
  if (typeof label !== "string") {
    throw new TypeError("comment takes a string, or null to remove the comment")
  }
  if (label.includes("*/") || label.includes("/*")) {
    throw new TypeError(`comment cannot contain "/*" or "*/": ${JSON.stringify(label)}`)
  }
  if (label.includes("\0")) {
    throw new TypeError("comment cannot contain a NUL character")
  }
  return label
}
