import { defineCodec } from "../codec/codec"

/** UUID as a string. */
export const uuid = /* @__PURE__ */ defineCodec({ sqlType: "uuid" })
