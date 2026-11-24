import { defineType } from "../type"

/** `boolean` values. */
export const boolean = /* @__PURE__ */ defineType({ sqlType: "boolean" }).transform({
  decode: decodeBoolean,
  encode: encodeBoolean,
})

/** Converts a Boolean value to its PostgreSQL text representation. */
export function encodeBoolean(value: boolean): string {
  return value ? "t" : "f"
}

/** Converts the PostgreSQL text representation of a Boolean value, `t` or `f`, to the value; rejects other text. */
export function decodeBoolean(text: string): boolean {
  if (text === "t") {
    return true
  }
  if (text === "f") {
    return false
  }
  throw new Error(`Unsupported boolean value "${text}"`)
}
