/** Quotes a PostgreSQL identifier, such as the name of a schema or a table, so that it keeps its case and characters. */
export function quoteIdentifier(name: string): string {
  return `"${name.replaceAll('"', '""')}"`
}
