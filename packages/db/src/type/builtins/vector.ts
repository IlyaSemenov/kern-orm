import { defineType } from "../type"
import { formatTypeName } from "../type-name"

/** `vector` of the pgvector extension as an array of numbers, such as `[1, 2, 3]`; `vector.with(dimensions)` sets the number of its dimensions. */
export const vector = /* @__PURE__ */ defineType({ sqlType: "vector" })
  .transform({
    // pgvector writes a vector as `[1,2.5,1e-05]`, which is JSON: it has no NaN or infinite elements.
    decode: text => JSON.parse(text) as number[],
    // `join` writes NaN and infinite elements as they are, so that PostgreSQL rejects them with the error of pgvector, rather than as the `null` of JSON.
    encode: (values: number[]) => `[${values.join(",")}]`,
  })
  .withParameters((dimensions: number) => formatTypeName("vector", dimensions))
