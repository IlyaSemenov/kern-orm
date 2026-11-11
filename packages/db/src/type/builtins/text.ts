import { defineType } from "../type"
import { formatTypeName } from "../type-name"

/** Variable-length string without a limit. */
export const text = /* @__PURE__ */ defineType({ sqlType: "text" })

/** Variable-length string; `varchar.with(length)` limits its length. */
export const varchar = /* @__PURE__ */ defineType({ sqlType: "varchar" }).withParameters(
  (length: number) => formatTypeName("varchar", length),
)

/** Fixed-length string that PostgreSQL pads with spaces; `char` alone has length 1, and `char.with(length)` sets the length. */
export const char = /* @__PURE__ */ defineType({
  sqlType: "char",
  castType: "bpchar",
}).withParameters((length: number) => formatTypeName("char", length))
