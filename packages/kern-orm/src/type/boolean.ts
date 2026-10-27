// Expressions import the Boolean type from this module rather than from `builtins/boolean.ts`, which creates it on load: inside the import cycle with expressions, that would run before `equalityOperators` and `defineType` are initialized.

import type { EqualityOperators } from "../expression/operators/equality"
import { equalityOperators } from "../expression/operators/equality"

import type { Type } from "./type"
import { defineType } from "./type"

let booleanType: Type<boolean, boolean, EqualityOperators> | undefined

/** Returns the shared Boolean type used by built-in expressions and columns. */
export function getBooleanType(): Type<boolean, boolean, EqualityOperators> {
  // Expressions and equality operators depend on each other, so initialize the type after their modules load.
  booleanType ??= defineType({ sqlType: "boolean" })
    .transform({
      decode: text => text === "t",
      encode: (value: boolean) => (value ? "t" : "f"),
    })
    .withOperators(equalityOperators)
  return booleanType
}
