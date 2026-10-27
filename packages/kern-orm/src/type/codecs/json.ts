/** Serializes a value as JSON text; values without a JSON representation, such as functions, are rejected. */
export function stringifyJson(value: unknown): string {
  const text = JSON.stringify(value)
  if (text === undefined) {
    throw new TypeError(`Cannot encode ${typeof value} as JSON`)
  }
  return text
}
