import { defineCodec } from "../codec/codec"

/** IP address with an optional netmask as a string, such as `192.168.0.1`. */
export const inet = /* @__PURE__ */ defineCodec({ sqlType: "inet" })

/** IP network as a string, such as `10.0.0.0/8`. */
export const cidr = /* @__PURE__ */ defineCodec({ sqlType: "cidr" })
