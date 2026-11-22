/** Returns the text with its first character in uppercase. */
export function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}
