import type { NoOperators, OperatorDefinitions } from "../../expression/operators/definitions"
import type { EqualityOperators, HasEquality } from "../../expression/operators/equality"
import { equalityOperators, hasEquality } from "../../expression/operators/equality"
import type { AnyType, TextValue, Type } from "../type"
import { defineType } from "../type"

/**
 * Creates a one-dimensional array type of `element` values.
 *
 * A `NULL` element decodes to `null`; a nullable `element` type, such as `array(text.nullable())`, types such elements.
 * Elements are separated by commas, as in arrays of all built-in types; a custom type with another delimiter, such as `box`, is not supported.
 * An array has `eq`, `ne`, and `in` when its element type has SQL `=`.
 */
export function array<Output, Input, O extends OperatorDefinitions>(
  // oxlint-disable-next-line typescript/no-explicit-any -- element parameters do not apply to arrays
  element: Type<Output, Input, O, any>,
): Type<Output[], Input[], HasEquality<O> extends true ? EqualityOperators : NoOperators> {
  const type: AnyType = defineType({
    sqlType: `${element.sqlType}[]`,
    castType: `${element.castType}[]`,
  }).transform({
    decode(text) {
      const values: unknown[] = parseArray(text)
      for (let index = 0; index < values.length; index++) {
        const value = values[index] as TextValue
        values[index] = value === null ? null : element.decode(value)
      }
      return values as Output[]
    },
    encode(values: Input[]) {
      let text = "{"
      for (let index = 0; index < values.length; index++) {
        const value = values[index]
        text += `${index === 0 ? "" : ","}${formatArrayElement(value === null ? null : element.encode(value as NonNullable<Input>))}`
      }
      return `${text}}`
    },
  })
  // PostgreSQL compares arrays by their elements, so an array has `=` only when its elements do.
  return (hasEquality(element) ? type.withOperators(equalityOperators) : type) as Type<
    Output[],
    Input[],
    HasEquality<O> extends true ? EqualityOperators : NoOperators
  >
}

/** Parses a one-dimensional array literal, such as `{a,"b c",NULL}`, into the text representations of its elements. */
export function parseArray(text: string): TextValue[] {
  // PostgreSQL prefixes the bounds of an array whose lower bound is not 1, such as `[0:1]={a,b}`.
  const start = text.startsWith("[") ? text.indexOf("=") + 1 : 0
  if (text[start] !== "{" || !text.endsWith("}")) {
    throw new Error(`Unsupported array value "${text}"`)
  }
  const elements: TextValue[] = []
  const end = text.length - 1
  if (start + 1 === end) {
    return elements
  }
  // Every loop stops at the closing brace, so malformed input throws instead of reading past it.
  let index = start + 1
  while (true) {
    if (text[index] === "{") {
      throw new Error("Multidimensional arrays are not supported")
    }
    if (text[index] === '"') {
      let element = ""
      index++
      while (index < end && text[index] !== '"') {
        if (text[index] === "\\") {
          index++
          if (index === end) {
            break
          }
        }
        element += text[index]
        index++
      }
      if (index === end) {
        throw new Error(`Unterminated quoted element in array value "${text}"`)
      }
      elements.push(element)
      // Skip the closing quote.
      index++
    } else {
      let next = text.indexOf(",", index)
      if (next === -1) {
        next = end
      }
      // PostgreSQL quotes an empty element, so an empty unquoted one means a malformed value.
      if (next === index) {
        throw new Error(`Malformed array value "${text}"`)
      }
      const element = text.slice(index, next)
      // Only an unquoted NULL is a null element; a quoted "NULL" is text.
      elements.push(element === "NULL" ? null : element)
      index = next
    }
    if (index === end) {
      return elements
    }
    if (text[index] !== ",") {
      throw new Error(`Malformed array value "${text}"`)
    }
    // Skip the delimiter.
    index++
  }
}

/** Formats the text representation of an array element, quoting it unless it is `NULL`. */
function formatArrayElement(element: TextValue): string {
  return element === null ? "NULL" : `"${element.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`
}
