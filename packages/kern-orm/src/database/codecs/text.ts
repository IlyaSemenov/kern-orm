import { defineCodec } from "../codec/codec"
import { formatTypeName } from "../codec/type-name"

/** Variable-length string without a limit. */
export const text = /* @__PURE__ */ defineCodec({ sqlType: "text" })

/** Variable-length string; `varchar.with(length)` limits its length. */
export const varchar = /* @__PURE__ */ defineCodec({ sqlType: "varchar" }).withParameters(
  (length: number) => formatTypeName("varchar", length),
)

/** Fixed-length string that PostgreSQL pads with spaces; `char` alone has length 1, and `char.with(length)` sets the length. */
export const char = /* @__PURE__ */ defineCodec({
  sqlType: "char",
  castType: "bpchar",
}).withParameters((length: number) => formatTypeName("char", length))
