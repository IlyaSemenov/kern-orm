import { orderingOperators } from "../../expression/operators/ordering"
import { textOperators } from "../../expression/operators/text"
import { defineType } from "../type"
import { formatTypeName } from "../type-name"

function defineTextType(sqlType: string, castType?: string) {
  return defineType({ sqlType, castType })
    .withOperators(orderingOperators)
    .withOperators(textOperators)
}

/** Variable-length string without a limit. */
export const text = /* @__PURE__ */ defineTextType("text")

/** Variable-length string; `varchar.with(length)` limits its length. */
export const varchar = /* @__PURE__ */ defineTextType("varchar").withParameters((length: number) =>
  formatTypeName("varchar", length),
)

/** Fixed-length string that PostgreSQL pads with spaces; `char` alone has length 1, and `char.with(length)` sets the length. */
export const char = /* @__PURE__ */ defineTextType("char", "bpchar").withParameters(
  (length: number) => formatTypeName("char", length),
)
