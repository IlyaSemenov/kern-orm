/** Quotes `name` as a PostgreSQL identifier, which keeps its case and any characters in it. */
export function quoteIdentifier(name: string): string {
  return `"${name.replaceAll('"', '""')}"`
}
