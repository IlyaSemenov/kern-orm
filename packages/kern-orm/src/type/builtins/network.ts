import { orderingOperators } from "../../expression/operators/ordering"
import { defineType } from "../type"

/** IP address with an optional netmask as a string, such as `192.168.0.1`. */
export const inet = /* @__PURE__ */ defineType({ sqlType: "inet" }).withOperators(orderingOperators)

/** IP network as a string, such as `10.0.0.0/8`. */
export const cidr = /* @__PURE__ */ defineType({ sqlType: "cidr" }).withOperators(orderingOperators)
