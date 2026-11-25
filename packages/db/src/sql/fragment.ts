// SQL fragments of the database layer: text with parameters, quoted names, literals, and nested fragments, and the renderer that turns a fragment into the text of a statement.

import type { SqlStatement, TextValue } from "../driver"
import { createStatement } from "../driver"
import { quoteIdentifier } from "../identifier"
import { encodeBytea } from "../type/builtins/bytea"
import type { AnyType, Type } from "../type/type"
import { isType } from "../type/type"

import type { UntypedValue } from "./parameter"
import {
  assertUntypedValue,
  bindParameter,
  describeRejectedValue,
  encodeParameter,
  rejectUntypedValue,
} from "./parameter"

/**
 * Static member of a class of the layer that extends `SqlFragment` and freezes its instances itself, after it sets their members.
 *
 * No entry point exports it, so a fragment of another class is frozen as it is created.
 */
export const freezesItself: unique symbol = Symbol("kern-db.freezesItself")

/**
 * SQL fragment: text with the parameters and the fragments interpolated into it, which `sql`, `joinSql`, `identifier`, `literal`, `unsafeSql`, and `param` create.
 *
 * It is immutable, and its parameters are numbered only when a statement is compiled, so a fragment can be interpolated into several statements.
 */
export class SqlFragment {
  // A fragment is told at runtime by its class, so types take no other object of its members, also a copy of a fragment, which a private member keeps out.
  /** Mark of fragments for types; absent at runtime. */
  declare private readonly fragmentBrand: true

  constructor(
    /** Text around the values; always one element longer than `values`. */
    readonly strings: readonly string[],
    /** Interpolated values: a fragment, the parameter of `param`, or the value of a parameter without a type. */
    readonly values: readonly unknown[],
  ) {
    // A class of the layer that sets members of its own, such as of the columns of a record, freezes itself after them.
    if (!(freezesItself in new.target)) {
      Object.freeze(this)
    }
  }
}

/** Parameter of `param`: a value that its type encodes. */
class TypedParameter {
  constructor(
    readonly type: AnyType,
    readonly value: unknown,
  ) {
    Object.freeze(this)
  }
}

/** Value that the template of `sql` interpolates: a fragment, or the value of a parameter, encoded by its JavaScript type. */
export type SqlValue = UntypedValue | SqlFragment

/**
 * Builds a SQL fragment.
 *
 * An interpolated fragment, such as of `identifier` or `param`, stays SQL, and another value becomes a parameter: a string, a number, a bigint, a Boolean, `null` for `NULL`, a `Date`, or a `Uint8Array`.
 * It rejects any other value, such as an object or an array: pass JSON or an array with `param` and its type.
 */
export function sql(strings: TemplateStringsArray, ...values: SqlValue[]): SqlFragment {
  for (let index = 0; index < values.length; index++) {
    const value = values[index]
    if (!(value instanceof SqlFragment)) {
      assertUntypedValue(value)
    }
  }
  return new SqlFragment([...strings], values)
}

const listSeparator = /* @__PURE__ */ new SqlFragment([", "], [])

/**
 * Joins `items` into one SQL fragment, such as the rows of a multi-row `VALUES` or the items of an `IN` list known only at runtime.
 *
 * It separates them by `separator`, or by `, ` without one.
 *
 * An item is what the template of `sql` interpolates: a fragment stays SQL, and another value becomes a parameter.
 * It rejects an empty array, since PostgreSQL rejects an empty list in most places of a list, such as `VALUES` and `IN`.
 */
export function joinSql(
  items: readonly SqlValue[],
  separator: SqlFragment = listSeparator,
): SqlFragment {
  if (!Array.isArray(items)) {
    throw new TypeError("joinSql() takes an array of fragments and values")
  }
  if (items.length === 0) {
    throw new TypeError("joinSql() takes at least one item")
  }
  if (!(separator instanceof SqlFragment)) {
    throw new TypeError("joinSql() takes a separator as a fragment, such as sql` AND `")
  }
  // The text and the values of the separator and of each fragment are copied into one fragment, so that rendering does not recurse into a fragment per item.
  const strings = [""]
  const values: unknown[] = []
  for (let index = 0; index < items.length; index++) {
    if (index > 0) {
      appendFragment(strings, values, separator)
    }
    const item = items[index]
    if (item instanceof SqlFragment) {
      appendFragment(strings, values, item)
    } else {
      assertUntypedValue(item)
      values.push(item)
      strings.push("")
    }
  }
  return new SqlFragment(strings, values)
}

/** Appends the text and the values of `fragment` to those of a fragment being built, whose `strings` are one element longer than its `values`. */
function appendFragment(strings: string[], values: unknown[], fragment: SqlFragment): void {
  const { strings: added, values: addedValues } = fragment
  strings[strings.length - 1] += added[0]!
  for (let index = 0; index < addedValues.length; index++) {
    values.push(addedValues[index])
    strings.push(added[index + 1]!)
  }
}

/**
 * Creates a SQL fragment of a quoted name, such as of a table or a column known only at runtime.
 *
 * Several names make a qualified name, such as `identifier(schema, table)` for `"schema"."table"`.
 * The fragment has no parameters, so the template of a script takes it.
 */
export function identifier(...names: [string, ...string[]]): SqlFragment {
  let text = ""
  for (const name of names) {
    if (typeof name !== "string" || name === "") {
      throw new TypeError("identifier() takes names as non-empty strings")
    }
    // Each name is quoted whole and never split at dots, since a quoted name may contain them.
    text += (text === "" ? "" : ".") + quoteIdentifier(name)
  }
  if (text === "") {
    throw new TypeError("identifier() takes at least one name")
  }
  return new SqlFragment([text], [])
}

/**
 * Creates a SQL fragment of the literal of `value`, for the places of a statement where PostgreSQL takes no parameter, such as the values of `ALTER`, `COMMENT`, and `SET`, and the template of a script.
 *
 * It takes the values that a parameter takes without a type.
 * A string, a `Date`, and a `Uint8Array` become a quoted literal, which PostgreSQL types by its place as it types a parameter; a number and a bigint become their digits, a Boolean `TRUE` or `FALSE`, and `null` `NULL`.
 * In place of a value of the statement, PostgreSQL reads the literal of a string as the value of a parameter of that string, whatever its characters, so it is safe for a value of a user there.
 * It is not safe inside a quoted string, a dollar-quoted string, or a comment of the template, which a value can end.
 * It rejects a number that is not finite and an integer number beyond the safe integers, which takes a bigint, and a string with a NUL character.
 * A negative number starts with its minus, so put a number in parentheses in an expression, such as `(${literal(delta)})::numeric`.
 *
 * Where PostgreSQL takes a parameter, interpolate the value itself instead.
 */
export function literal(value: UntypedValue): SqlFragment {
  return new SqlFragment([formatLiteral(value)], [])
}

/** Returns the SQL literal of `value`, rejecting a value that has none. */
function formatLiteral(value: UntypedValue): string {
  switch (typeof value) {
    case "string":
      return quoteLiteral(value)
    case "number":
      if (!Number.isFinite(value)) {
        throw new TypeError(`literal() takes a finite number, not ${value}`)
      }
      // Every number from 2^53 on is an integer whose digits may differ from those that the code wrote.
      if (Number.isInteger(value) && !Number.isSafeInteger(value)) {
        throw new TypeError(
          `literal() takes an integer beyond the safe integers as a bigint, not as the number ${value}, which may have lost its digits`,
        )
      }
      // A number is not quoted, since places such as `RESTART WITH` and `INCREMENT BY` take only a numeric constant, and not in parentheses, which they reject too.
      return String(value)
    case "bigint":
      return String(value)
    case "boolean":
      return value ? "TRUE" : "FALSE"
    case "object":
      if (value === null) {
        return "NULL"
      }
      if (value instanceof Date) {
        if (Number.isNaN(value.getTime())) {
          throw new TypeError("literal() takes no invalid Date")
        }
        return quoteLiteral(value.toISOString())
      }
      if (value instanceof Uint8Array) {
        return quoteLiteral(encodeBytea(value))
      }
  }
  if (value === undefined) {
    throw new TypeError("literal() takes no undefined; use null for NULL")
  }
  throw new TypeError(
    `literal() takes a string, a number, a bigint, a boolean, null, a Date, or a Uint8Array, not ${describeRejectedValue(value)}; pass JSON as its text with a cast in the statement`,
  )
}

/**
 * Quotes `text` as a string literal, as `quote_literal` of PostgreSQL does.
 *
 * It doubles quotes, and writes a text with a backslash as an escape string with its backslashes doubled, so that the literal keeps its value whatever `standard_conforming_strings` is.
 * It rejects a NUL character, which PostgreSQL takes neither in text nor in a statement.
 */
function quoteLiteral(text: string): string {
  if (text.includes("\0")) {
    throw new TypeError("literal() takes no string with a NUL character")
  }
  const quoted = `'${text.replaceAll("'", "''")}'`
  return text.includes("\\") ? `E${quoted.replaceAll("\\", "\\\\")}` : quoted
}

/**
 * Creates a SQL fragment of `text` as it is, without quoting or checking it, such as of a type with its modifiers or of a comment that code computes.
 *
 * Never pass it input of a user, or text that contains such input: it runs as SQL.
 * Interpolate a value as a parameter or with `literal`, a name with `identifier`, and a keyword chosen among a few as a fragment of `sql`, such as `` descending ? sql`DESC` : sql`ASC` ``, whenever one fits.
 */
export function unsafeSql(text: string): SqlFragment {
  if (typeof text !== "string") {
    throw new TypeError("unsafeSql() takes SQL text as a string")
  }
  return new SqlFragment([text], [])
}

/**
 * Creates a SQL fragment of a parameter that `type` encodes, such as of JSON or of an array, cast to its cast type, such as `$1::jsonb`.
 *
 * The cast omits type parameters, such as `$1::numeric` for `numeric(10,2)`, so that their precision, scale, or length do not constrain the value.
 */
export function param<Output, Input>(
  type: Type<Output, Input>,
  value: NoInfer<Input>,
): SqlFragment {
  if (!isType(type)) {
    throw new TypeError("param() takes a type and the value that it encodes")
  }
  if (value === undefined) {
    rejectUntypedValue(value)
  }
  // Text after a cast could continue its type name, such as a subscript `[1]` after `integer[]`, so the cast is in parentheses.
  return new SqlFragment(["(", `::${type.castType})`], [new TypedParameter(type, value)])
}

/** Receives the parameters of a statement in the order of its text as a fragment renders, and returns their placeholders, such as `$1`. */
export interface ParameterBinder {
  /** Adds the parameter of the text representation `value`. */
  bind(value: TextValue): string
  /**
   * Adds the parameter of a fragment of `param`, of the text representation `value`.
   *
   * `key` is the same object wherever a statement repeats the fragment, so that a binder can give its parameter one placeholder: the cast types it the same at every place.
   */
  bindParam(key: object, value: TextValue): string
}

/** Renders `fragment` into SQL text, encoding its parameters and binding them with `binder` in the order of the text. */
export function renderFragment(fragment: SqlFragment, binder: ParameterBinder): string {
  const { strings, values } = fragment
  let text = strings[0]!
  for (let index = 0; index < values.length; index++) {
    const value = values[index]
    if (value instanceof SqlFragment) {
      text += renderFragment(value, binder)
    } else if (value instanceof TypedParameter) {
      text += binder.bindParam(value, encodeParameter(value.value, value.type))
    } else {
      text += binder.bind(encodeParameter(value, undefined))
    }
    text += strings[index + 1]!
  }
  return text
}

/**
 * Compiles `fragment` into a statement, numbering its parameters in the order of the text.
 *
 * It binds the parameter of a fragment of `param` once, under one placeholder wherever the statement repeats the fragment, since its cast types it the same at every place; it binds another value at each place, so that PostgreSQL types it by that place.
 */
export function compileFragment(fragment: SqlFragment): SqlStatement {
  const parameters: TextValue[] = []
  // The first `param` is kept apart and the map is created at the second one, so that a statement of one `param` pays nothing for the map.
  let firstKey: object | undefined
  let firstPlaceholder = ""
  let placeholders: Map<object, string> | undefined
  const text = renderFragment(fragment, {
    bind: value => bindParameter(parameters, value),
    bindParam(key, value) {
      if (key === firstKey) {
        return firstPlaceholder
      }
      if (firstKey === undefined) {
        firstKey = key
        firstPlaceholder = bindParameter(parameters, value)
        return firstPlaceholder
      }
      placeholders ??= new Map()
      let placeholder = placeholders.get(key)
      if (placeholder === undefined) {
        placeholder = bindParameter(parameters, value)
        placeholders.set(key, placeholder)
      }
      return placeholder
    },
  })
  return createStatement(text, parameters)
}

/** Compiles `fragment` into the text of a script, rejecting a parameter at any depth of the fragment, since PostgreSQL takes several statements only without parameters. */
export function compileScript(fragment: SqlFragment): string {
  return renderFragment(fragment, scriptBinder)
}

/** Binder of a script, which takes no parameters. */
const scriptBinder: ParameterBinder = {
  bind: rejectScriptParameter,
  bindParam: rejectScriptParameter,
}

function rejectScriptParameter(): never {
  throw new Error(
    "A script has no parameters, so its template takes no values, also in the fragments that it interpolates",
  )
}
