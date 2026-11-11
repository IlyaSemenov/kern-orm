import { defineCodec } from "../codec/codec"

/** `boolean` values. */
export const boolean = /* @__PURE__ */ defineCodec({ sqlType: "boolean" }).transform({
  decode: decodeBoolean,
  encode: encodeBoolean,
})

/** Converts a Boolean value to its PostgreSQL text representation. */
export function encodeBoolean(value: boolean): string {
  return value ? "t" : "f"
}

/** Converts the PostgreSQL text representation of a Boolean value, `t` or `f`, to the value. */
export function decodeBoolean(text: string): boolean {
  return text === "t"
}
