// SQL fragments of the database layer: text with parameters, quoted names, and nested fragments, and the renderer that turns a fragment into the text of a statement.

import type { AnyCodec, Codec } from "../codec/codec"
import { isCodec } from "../codec/codec"
import type { SqlStatement, TextValue } from "../driver"
import { createStatement } from "../driver"
import { quoteIdentifier } from "../identifier"

import type { UntypedValue } from "./parameter"
import { bindParameter, encodeParameter, isUntypedValue, rejectUntypedValue } from "./parameter"

/**
 * SQL fragment: text with the parameters and the fragments interpolated into it, which `sql`, `identifier`, and `param` create.
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
    /** Interpolated values: a fragment, the parameter of `param`, or the value of a parameter without a codec. */
    readonly values: readonly unknown[],
  ) {
    Object.freeze(this)
  }
}

/** Parameter of `param`: a value that its codec encodes. */
class CodecParameter {
  constructor(
    readonly codec: AnyCodec,
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
 * It rejects any other value, such as an object or an array: pass JSON or an array with `param` and its codec.
 */
export function sql(strings: TemplateStringsArray, ...values: SqlValue[]): SqlFragment {
  for (let index = 0; index < values.length; index++) {
    const value = values[index]
    if (!(value instanceof SqlFragment) && !isUntypedValue(value)) {
      rejectUntypedValue(value)
    }
  }
  return new SqlFragment([...strings], values)
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
 * Creates a SQL fragment of a parameter that `codec` encodes, such as of JSON or of an array, cast to the type of the codec, such as `$1::jsonb`.
 *
 * The cast omits type parameters, such as `$1::numeric` for `numeric(10,2)`, so that their precision, scale, or length do not constrain the value.
 */
export function param<Output, Input>(
  codec: Codec<Output, Input>,
  value: NoInfer<Input>,
): SqlFragment {
  if (!isCodec(codec)) {
    throw new TypeError("param() takes a codec and the value that it encodes")
  }
  if (value === undefined) {
    rejectUntypedValue(value)
  }
  // Text after a cast could continue its type name, such as a subscript `[1]` after `integer[]`, so the cast is in parentheses.
  return new SqlFragment(["(", `::${codec.castType})`], [new CodecParameter(codec, value)])
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
    } else if (value instanceof CodecParameter) {
      text += binder.bindParam(value, encodeParameter(value.value, value.codec))
    } else {
      text += binder.bind(encodeParameter(value, undefined))
    }
    text += strings[index + 1]!
  }
  return text
}

/** Compiles `fragment` into a statement, numbering its parameters in the order of the text. */
export function compileFragment(fragment: SqlFragment): SqlStatement {
  const parameters: TextValue[] = []
  const bind = (value: TextValue) => bindParameter(parameters, value)
  const text = renderFragment(fragment, { bind, bindParam: (_key, value) => bind(value) })
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
