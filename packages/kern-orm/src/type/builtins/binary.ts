import { equalityOperators } from "../../expression/operators/equality"
import { decodeBytea, encodeBytea } from "../codecs/bytea"
import { defineType } from "../type"

/** Binary data; PostgreSQL represents it in hex, which requires the default `bytea_output` setting. */
export const bytea = /* @__PURE__ */ defineType({ sqlType: "bytea" })
  .transform({
    decode: decodeBytea,
    encode: encodeBytea,
  })
  .withOperators(equalityOperators)
