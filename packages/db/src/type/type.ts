// Types: the contract by which the database layer converts the values of a PostgreSQL type, and the types that `defineType` creates.

import type { SynchronousResult } from "../utils/synchronous"
import { rejectThenable } from "../utils/synchronous"

declare const typeValues: unique symbol
// Exported so that a type of a query builder declares the members of a type without extending `Type`.
export type { typeValues }

/** Runtime mark of types, which tells them apart from other objects with the same members. */
const typeBrand = Symbol("kern-db.type")

/**
 * Type of PostgreSQL values: the SQL names of the type and the conversion between JavaScript values and their PostgreSQL text representation.
 *
 * `Output` are the values that it returns and `Input` those that it accepts, where `null` stands for `NULL`.
 * `defineType` creates a type, and an object that copies the members of a type is a type too.
 */
export interface Type<Output, Input = Output> {
  /** Value types for type inference; absent at runtime. */
  readonly [typeValues]: { output: Output; input: Input }
  /** SQL type name used in DDL, such as `numeric` or `vector(1536)`. */
  readonly sqlType: string
  /**
   * SQL type name that a parameter is cast to, such as `numeric` for `numeric(10,2)`.
   *
   * It omits type parameters, so that their precision, scale, or length do not constrain a parameter.
   */
  readonly castType: string
  readonly isNullable: boolean
  // A property of a function type rather than a method, whose parameters TypeScript compares bivariantly: a type is not one of more accepted values.
  /** Converts a non-null value to its PostgreSQL text representation; it does not read `this`. */
  readonly encode: (value: NonNullable<Input>) => string
  /** Converts a non-null PostgreSQL text representation to a value; it does not read `this`. */
  readonly decode: (text: string) => Exclude<Output, null>
  /**
   * Optional function that maps the SQL of a value to the SQL expression whose result `decode` reads, such as `extract(epoch from "run_at")` for `"run_at"`; it does not read `this`.
   *
   * Statements returning a value of this type must select it through this expression.
   */
  readonly read: ((value: string) => string) | undefined
  /** Optional function that returns the value that a result has for `NULL` instead of `null`, such as `undefined`; it does not read `this`. */
  readonly decodeNull: (() => Exclude<Output, null>) | undefined
}

/** Type of any values. */
// oxlint-disable-next-line typescript/no-explicit-any -- any type regardless of its value types
export type AnyType = Type<any, any>

/** Values that a type returns. */
export type TypeOutput<T extends AnyType> = T[typeof typeValues]["output"]

/** Values that a type accepts. */
export type TypeInput<T extends AnyType> = T[typeof typeValues]["input"]

/**
 * Type that derives other types of its PostgreSQL type, as `defineType` creates it.
 *
 * A type with PostgreSQL type parameters, such as the length of `varchar(255)`, has `with`.
 */
export type DerivableType<
  Output,
  Input = Output,
  Parameters extends unknown[] | undefined = undefined,
> = BaseDerivableType<Output, Input, Parameters> &
  (Parameters extends unknown[] ? DerivableTypeWithParameters<Output, Input, Parameters> : unknown)

/** Members of every derivable type; see `DerivableType`. */
export interface BaseDerivableType<
  Output,
  Input,
  Parameters extends unknown[] | undefined,
> extends Type<Output, Input> {
  /**
   * Creates a type that accepts PostgreSQL type parameters with `with`.
   *
   * `format` returns the SQL type name with the parameters, such as `vector(1536)` for `1536`.
   */
  withParameters<P extends unknown[]>(
    format: (...parameters: P) => string,
  ): DerivableType<Output, Input, P>
  // `null` among the values that a type returns stands for `NULL`, so `decode` cannot return it.
  // Nullability is read from the values that it accepts, where `null` is always `NULL`: those that it returns may be `unknown`, which includes `null`, as for JSON values.
  /**
   * Creates a type with another representation of the values of this type, keeping its SQL type and nullability.
   * An `encode` that takes `null` also makes the result nullable.
   *
   * `decode` receives the values that this type decodes from values other than `NULL`, including `undefined` that an earlier decoder returns, and returns a value other than `null`; `encode` returns values that this type encodes; `NULL` stays `null` without them.
   */
  transform<NewOutput extends {} | undefined, NewInput>(
    options: TypeTransform<Exclude<Output, null>, NonNullable<Input>, NewOutput, NewInput>,
  ): DerivableType<
    NewOutput | AcceptedNull<NewInput | Input>,
    NewInput | AcceptedNull<Input>,
    Parameters
  >
  /** Creates a type that decodes the values of this type into another representation, other than `null`, and accepts the values that this type accepts. */
  transform<NewOutput extends {} | undefined>(options: {
    decode: (value: Exclude<Output, null>) => NewOutput
  }): DerivableType<NewOutput | AcceptedNull<Input>, Input, Parameters>
  /** Creates a type whose values include `null`, which stands for `NULL`. */
  nullable(): DerivableType<Output | null, Input | null, Parameters>
  /**
   * Creates a nullable type that returns the value of `decodeNull` for `NULL` instead of `null`, such as `undefined`, which tells `NULL` of a `jsonb` value from a JSON `null` value.
   *
   * `decodeNull` is called for each `NULL`, so it can return a new object each time; it must return its value synchronously, and not `null`.
   * The type accepts `null`, which stands for `NULL`, as every nullable type does.
   * Its values are final: its `transform`, `of`, and `nullable` reject, so call them before it.
   * Its `nullableAs` rejects too, so call it once with one function.
   */
  nullableAs<Null extends {} | undefined>(
    decodeNull: () => Null & SynchronousResult<Null>,
  ): DerivableType<Exclude<Output, null> | Null, Input | null, Parameters>
  /**
   * Narrows the values of this type to `T` in TypeScript, such as to a union of strings that a `CHECK` constraint allows, or to the shape of JSON values.
   *
   * The values are not validated at runtime.
   * `T` must be among the values that this type both returns and accepts, and `nullable` keeps `null` apart from it.
   */
  of<T extends AcceptedValues<Exclude<Output, null>, Exclude<Input, null>>>(): DerivableType<
    T | AcceptedNull<Input>,
    T | AcceptedNull<Input>,
    Parameters
  >
}

/** Members of a derivable type with PostgreSQL type parameters; see `DerivableType`. */
export interface DerivableTypeWithParameters<Output, Input, Parameters extends unknown[]> {
  /** Creates this type with PostgreSQL type parameters, such as `varchar.with(255)` for `varchar(255)`; other changes of the type are kept. */
  with(...parameters: Parameters): DerivableType<Output, Input, Parameters>
}

/** Derivable type of any values and parameters. */
// oxlint-disable-next-line typescript/no-explicit-any -- any type regardless of its value types and parameters
export type AnyDerivableType = DerivableType<any, any, any>

/**
 * Values that `of` can narrow a type to: those both among the values `O` that it returns and among the values `I` that it accepts, or `UnacceptedValues` when there are none.
 *
 * A narrowed value is also accepted, so its encoder must take it.
 */
// When one of the types contains the other, as the values of every built-in type do, it stands for the intersection, which an error would show as `string | (string & Date)` for `timestamptz`.
export type AcceptedValues<O, I> = [O] extends [I]
  ? O
  : [I] extends [O]
    ? I
    : [O & I] extends [never]
      ? UnacceptedValues
      : O & I

/** `null` when the accepted values `I` include it, also as `unknown`; `never` otherwise. */
export type AcceptedNull<I> = null extends I ? null : never

/** Type that `AcceptedValues` names for a type that accepts none of the values it returns. */
interface UnacceptedValues {
  readonly "of narrows only a type that accepts the values it returns": never
}

/** Conversion between the values of a type and their new representation. */
export interface TypeTransform<Output, Input, NewOutput, NewInput> {
  decode: (value: Output) => NewOutput
  encode: (value: NewInput) => Input
}

/** Type definition. */
export interface TypeOptions {
  /** SQL type name, such as `ltree`; `withParameters` adds type parameters to it, and a name with them requires `castType`. */
  sqlType: string
  /** SQL type name that parameters are cast to when `sqlType` constrains values, such as `bpchar` for `char`, whose length is 1. */
  castType?: string
  /**
   * Returns the SQL expression by which the values of the type are read, from `value`, the SQL of an expression of the type, such as `` value => `extract(epoch from ${value})` `` for a `timestamptz` read as seconds since the epoch, whose text does not depend on `DateStyle`.
   *
   * The type, and the types derived from it, decode the PostgreSQL text representation of the result of the expression rather than of the value.
   * The expression must be `NULL` for `NULL` and for no other value.
   * The function must give the same SQL for the same `value`, and must write `value` once in it, whatever the value: a statement would evaluate a value written twice at both places.
   * `defineType` checks it for a sample value.
   * `value` may be of a wider PostgreSQL type where PostgreSQL computes it in one, such as the `numeric` average of `integer` values.
   */
  read?: (value: string) => string
}

/**
 * Defines a type whose values are the PostgreSQL text representations as they are.
 *
 * `transform` converts them to other values, such as `number[]` for `vector`.
 */
export function defineType(
  // A type has the members of the options, so the options are checked not to be one: it would give a type of strings of its SQL type, without its conversion and nullability.
  options: TypeOptions & { readonly [typeValues]?: NotTypeOptions },
): DerivableType<string> {
  if (isType(options)) {
    throw new TypeError("defineType() of kern-db takes options, not a type")
  }
  // Casting a parameter to type parameters would apply their precision, scale, or length to it.
  if (options.castType === undefined && options.sqlType.includes("(")) {
    throw new TypeError(
      `Define the type parameters of "${options.sqlType}" using withParameters(), or set castType`,
    )
  }
  const { read } = options
  if (read !== undefined) {
    // The expression is SQL text, which a statement takes as it is, so a function that returns another value, such as a fragment of `sql`, is rejected here rather than in a statement.
    const text: unknown = typeof read === "function" ? read(valueProbe) : undefined
    // A value written twice would be evaluated twice, such as a volatile expression that a query selects; the check finds the mistake for the probe, not for every value.
    if (typeof text !== "string" || text.split(valueProbe).length !== 2) {
      throw new TypeError(
        `The read option of type "${options.sqlType}" must be a function that returns the SQL text of an expression that refers to its value once`,
      )
    }
  }
  return createType({
    sqlType: options.sqlType,
    castType: options.castType ?? options.sqlType,
    encode: keepText,
    decode: keepText,
    read,
    decodeNull: undefined,
    isNullable: false,
    formatSqlType: undefined,
  })
}

/** SQL of a value that `defineType` passes to a `read` option to find the value in the expression: a character that SQL text does not contain. */
const valueProbe = "\u0000"

/** Type that the options of `defineType` are checked against when they are a type, naming the reason. */
interface NotTypeOptions {
  readonly "defineType of kern-db takes options, not a type": never
}

/** Tells whether `value` is a type, including an object that copies the members of one. */
export function isType(value: unknown): value is AnyType {
  return typeof value === "object" && value !== null && typeBrand in value
}

/**
 * Returns the value that a result has for `NULL` of a value of `type`: `null`, or the value of `decodeNull` of a type that has it.
 *
 * It rejects a thenable that `decodeNull` returns, such as of an async function, which types reject: it would leave a Promise in the result and lose its error.
 */
export function decodeNull(type: AnyType): unknown {
  const decode = type.decodeNull
  if (decode === undefined) {
    return null
  }
  const value = decode()
  rejectThenable(value, decodeNullMessage)
  return value
}

/** Message of the error of a thenable that `decodeNull` of a type returns. */
const decodeNullMessage =
  "The function of nullableAs() must return the value of NULL synchronously, not a Promise or a query"

interface TypeState {
  readonly sqlType: string
  readonly castType: string
  // oxlint-disable-next-line typescript/no-explicit-any -- the caller types the values
  readonly encode: (value: any) => string
  readonly decode: (text: string) => unknown
  readonly read: ((value: string) => string) | undefined
  readonly decodeNull: (() => unknown) | undefined
  readonly isNullable: boolean
  /** Formats the SQL type name with type parameters; types without parameters have none. */
  readonly formatSqlType: ((...parameters: never[]) => string) | undefined
}

function createType(state: TypeState): AnyDerivableType {
  const derive = (changes: Partial<TypeState>) => createType({ ...state, ...changes })
  // The values of a type do not tell in types what its `NULL` decodes to, so the types of a type derived from them would give `null` for it.
  const rejectDecodedNull = (method: string) => {
    if (state.decodeNull !== undefined) {
      throw new TypeError(
        method === "nullableAs"
          ? "nullableAs() cannot change a type that decodes NULL to a value; call it once with one function"
          : `${method}() cannot change a type that decodes NULL to a value, which nullableAs() creates`,
      )
    }
  }
  const { formatSqlType } = state
  // The brand and the members are own enumerable properties, so that an object that copies them, with members of its own, is a type.
  const type: AnyDerivableType = Object.freeze({
    [typeBrand]: true,
    sqlType: state.sqlType,
    castType: state.castType,
    isNullable: state.isNullable,
    encode: state.encode,
    decode: state.decode,
    read: state.read,
    decodeNull: state.decodeNull,
    // oxlint-disable-next-line typescript/no-explicit-any -- the caller types the values
    transform: ({ decode, encode }: Partial<TypeTransform<any, any, any, any>>) => {
      rejectDecodedNull("transform")
      return derive({
        encode: encode ? value => state.encode(encode(value)) : state.encode,
        decode: text => decode!(state.decode(text)),
      })
    },
    withParameters: (format: (...parameters: never[]) => string) =>
      derive({ formatSqlType: format }),
    // Type parameters change only the SQL type name, so the other changes of the type are kept.
    ...(formatSqlType && {
      with: (...parameters: never[]) => derive({ sqlType: formatSqlType(...parameters) }),
    }),
    nullable: () => {
      rejectDecodedNull("nullable")
      return derive({ isNullable: true })
    },
    nullableAs: (decodeNull: () => unknown) => {
      rejectDecodedNull("nullableAs")
      if (typeof decodeNull !== "function") {
        throw new TypeError("nullableAs() takes a function that returns the value of NULL")
      }
      return derive({ isNullable: true, decodeNull })
    },
    of: () => {
      rejectDecodedNull("of")
      // The narrowed values exist only in TypeScript.
      return type
    },
  }) as unknown as AnyDerivableType
  return type
}

/** Encodes and decodes a value that is its PostgreSQL text representation. */
function keepText(text: string): string {
  return text
}
