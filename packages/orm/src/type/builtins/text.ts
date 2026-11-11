import * as codecs from "kern-db/types"

import { defineTextType, getTextType } from "../text"

/** Variable-length string without a limit. */
export const text = /* @__PURE__ */ getTextType()

/** Variable-length string; `varchar.with(length)` limits its length. */
export const varchar = /* @__PURE__ */ defineTextType(codecs.varchar)

/** Fixed-length string that PostgreSQL pads with spaces; `char` alone has length 1, and `char.with(length)` sets the length. */
export const char = /* @__PURE__ */ defineTextType(codecs.char)
