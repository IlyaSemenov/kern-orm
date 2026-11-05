import { defineTextType, getTextType } from "../text"
import { formatTypeName } from "../type-name"

/** Variable-length string without a limit. */
export const text = /* @__PURE__ */ getTextType()

/** Variable-length string; `varchar.with(length)` limits its length. */
export const varchar = /* @__PURE__ */ defineTextType("varchar").withParameters((length: number) =>
  formatTypeName("varchar", length),
)

/** Fixed-length string that PostgreSQL pads with spaces; `char` alone has length 1, and `char.with(length)` sets the length. */
export const char = /* @__PURE__ */ defineTextType("char", "bpchar").withParameters(
  (length: number) => formatTypeName("char", length),
)
