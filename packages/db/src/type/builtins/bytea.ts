import { Buffer } from "node:buffer"

import { defineType } from "../type"

/** Binary data; PostgreSQL represents it in hex, which requires the default `bytea_output` setting. */
export const bytea = /* @__PURE__ */ defineType({ sqlType: "bytea" }).transform({
  decode: decodeBytea,
  encode: encodeBytea,
})

/** Encodes bytes as the hex text representation of `bytea`, such as `\\x00ff`. */
export function encodeBytea(bytes: Uint8Array): string {
  return "\\x" + encodeHex(bytes)
}

/** Decodes the hex text representation of `bytea` into bytes; rejects text with an odd number of hex digits, whose last digit would be lost, and does not check the digits. */
export function decodeBytea(text: string): Uint8Array {
  if (!text.startsWith("\\x")) {
    throw new Error(
      "Unsupported bytea value; kern-db expects bytea_output hex, which the connection options of the client can set",
    )
  }
  if (text.length % 2 !== 0) {
    throw new Error("Unsupported bytea value: it has an odd number of hex digits")
  }
  return decodeHex(text.slice(2))
}

// The conversion is chosen once, by the runtime: the native hex methods of `Uint8Array` where it has them, and `Buffer` on Node.js 24, which lacks them, since both are faster than a loop of JavaScript in the benchmarks of results and parameters and `Buffer` is several times slower than the native methods on Bun.

/** Encodes bytes as hex digits. */
const encodeHex = /* @__PURE__ */ selectHexEncoder()

/** Decodes an even number of hex digits into bytes. */
const decodeHex = /* @__PURE__ */ selectHexDecoder()

/** Returns the conversion of bytes to hex digits of the runtime. */
function selectHexEncoder(): (bytes: Uint8Array) => string {
  const toHex = Uint8Array.prototype.toHex
  return typeof toHex === "function"
    ? // The method of the prototype, so that a `toHex` of the bytes themselves does not change what they encode to.
      bytes => toHex.call(bytes)
    : bytes => Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("hex")
}

/** Returns the conversion of hex digits to bytes of the runtime; neither conversion checks the digits apart from failing where it cannot read them. */
function selectHexDecoder(): (hex: string) => Uint8Array {
  return typeof Uint8Array.fromHex === "function"
    ? hex => Uint8Array.fromHex(hex)
    : hex => {
        const buffer = Buffer.from(hex, "hex")
        // `Buffer.from` stops at a character that it does not read as a hex digit, such as `z`, which would lose the bytes after it; it reads some other characters, such as `ı`, as digits.
        if (buffer.length * 2 !== hex.length) {
          throw new Error("Unsupported bytea value: it has a character that is not a hex digit")
        }
        // The copy is a `Uint8Array` with a memory of its own: a small `Buffer` is a view of a pool shared with other buffers, which its `buffer` would expose, and its class differs from `Uint8Array` in deep equality.
        return new Uint8Array(buffer)
      }
}
