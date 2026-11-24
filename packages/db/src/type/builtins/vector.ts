import { defineType } from "../type"
import { formatTypeName } from "../type-name"

/** `vector` of the pgvector extension as an array of numbers, such as `[1, 2, 3]`; `vector.with(dimensions)` sets the number of its dimensions. */
export const vector = /* @__PURE__ */ defineType({ sqlType: "vector" })
  .transform({
    decode: decodeVector,
    // `join` writes NaN and infinite elements as they are, so that PostgreSQL rejects them with the error of pgvector, rather than as the `null` of JSON.
    encode: (values: number[]) => `[${values.join(",")}]`,
  })
  .withParameters((dimensions: number) => formatTypeName("vector", dimensions))

/** Decodes the text of a vector, such as `[1,2.5,1e-05]`, into its numbers; rejects JSON other than an array, without checking its elements. */
function decodeVector(text: string): number[] {
  // pgvector writes a vector as JSON: it has no NaN or infinite elements.
  const values: unknown = JSON.parse(text)
  if (!Array.isArray(values)) {
    throw new Error("Unsupported vector value: it is not an array")
  }
  return values as number[]
}
