// Type and text literal helpers for one-dimensional PostgreSQL arrays, such as `{a,"b c",NULL}`.

import type { TextValue } from "../../driver"
import type { DerivableType, Type } from "../type"
import { defineType } from "../type"

/**
 * Creates a type of one-dimensional arrays of `element` values.
 *
 * A `NULL` element decodes to `null`; a nullable `element` type, such as `array(text.nullable())`, types such elements.
 * Elements are separated by commas, as in arrays of all built-in types; a custom type with another delimiter, such as `box`, is not supported.
 */
export function array<Output, Input>(
  element: Type<Output, Input>,
): DerivableType<Output[], Input[]> {
  const encodeElement = (value: Input) =>
    value === null ? null : element.encode(value as NonNullable<Input>)
  // The type parameters of the element, such as the length of `varchar(255)`, stay in the SQL type and not in the cast type.
  return defineType({
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
    encode: (values: Input[]) => formatArray(values, encodeElement),
  })
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

/**
 * Formats `values` as an array literal, such as `{"a","b c",NULL}`, of the text representations that `encodeElement` returns.
 *
 * It quotes every element other than `NULL`, so that it needs no scan for the characters that PostgreSQL requires to quote.
 */
export function formatArray<T>(
  values: readonly T[],
  encodeElement: (value: T) => TextValue,
): string {
  let text = "{"
  for (let index = 0; index < values.length; index++) {
    text += `${index === 0 ? "" : ","}${formatArrayElement(encodeElement(values[index] as T))}`
  }
  return `${text}}`
}

/** Formats the text representation of an array element, quoting it unless it is `NULL`. */
function formatArrayElement(element: TextValue): string {
  return element === null ? "NULL" : `"${element.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`
}
