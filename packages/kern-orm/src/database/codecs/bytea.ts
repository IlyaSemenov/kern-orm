const hexDigits = "0123456789abcdef"

/** Encodes bytes as a hex `bytea` literal, such as `\\x00ff`. */
export function encodeBytea(bytes: Uint8Array): string {
  let text = "\\x"
  for (const byte of bytes) {
    text += hexDigits[byte >> 4]! + hexDigits[byte & 15]!
  }
  return text
}

/** Decodes a hex `bytea` literal into bytes. */
export function decodeBytea(text: string): Uint8Array {
  if (!text.startsWith("\\x")) {
    throw new Error("Unsupported bytea value; kern-orm expects bytea_output hex")
  }
  const bytes = new Uint8Array((text.length - 2) / 2)
  for (let index = 0; index < bytes.length; index++) {
    bytes[index] = (readHexDigit(text, 2 + index * 2) << 4) | readHexDigit(text, 3 + index * 2)
  }
  return bytes
}

/** Reads the hex digit at `index`, in either case. */
function readHexDigit(text: string, index: number): number {
  const code = text.charCodeAt(index)
  // Letters are folded to lowercase before converting a to f.
  return code <= 57 ? code - 48 : (code | 32) - 87
}
