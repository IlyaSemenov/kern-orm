// Text operators import the `text` type from this module rather than from `builtins/text.ts`, which creates it on load: inside the import cycle with them, that would run before `textOperators` are initialized.

import { orderingOperators } from "../expression/operators/ordering"
import type { TextTypeOperators } from "../expression/operators/text"
import { textOperators } from "../expression/operators/text"

import type { Type } from "./type"
import { defineType } from "./type"

/** Defines a text type with the operators of the built-in text types. */
export function defineTextType(sqlType: string, castType?: string) {
  return defineType({ sqlType, castType })
    .withOperators(orderingOperators)
    .withOperators(textOperators)
}

let textType: Type<string, string, TextTypeOperators> | undefined

/** Returns the shared `text` type used by built-in expressions and columns. */
export function getTextType(): Type<string, string, TextTypeOperators> {
  // Text operators return expressions of this type, so initialize it after their module loads.
  textType ??= defineTextType("text")
  return textType
}
