// Types: the contract by which the database layer converts the values of a PostgreSQL type, and the types that `defineType` creates.

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
  return createType({
    sqlType: options.sqlType,
    castType: options.castType ?? options.sqlType,
    encode: keepText,
    decode: keepText,
    isNullable: false,
    formatSqlType: undefined,
  })
}

/** Type that the options of `defineType` are checked against when they are a type, naming the reason. */
interface NotTypeOptions {
  readonly "defineType of kern-db takes options, not a type": never
}

/** Tells whether `value` is a type, including an object that copies the members of one. */
export function isType(value: unknown): value is AnyType {
  return typeof value === "object" && value !== null && typeBrand in value
}

interface TypeState {
  readonly sqlType: string
  readonly castType: string
  // oxlint-disable-next-line typescript/no-explicit-any -- the caller types the values
  readonly encode: (value: any) => string
  readonly decode: (text: string) => unknown
  readonly isNullable: boolean
  /** Formats the SQL type name with type parameters; types without parameters have none. */
  readonly formatSqlType: ((...parameters: never[]) => string) | undefined
}

function createType(state: TypeState): AnyDerivableType {
  const derive = (changes: Partial<TypeState>) => createType({ ...state, ...changes })
  const { formatSqlType } = state
  // The brand and the members are own enumerable properties, so that an object that copies them, with members of its own, is a type.
  const type: AnyDerivableType = Object.freeze({
    [typeBrand]: true,
    sqlType: state.sqlType,
    castType: state.castType,
    isNullable: state.isNullable,
    encode: state.encode,
    decode: state.decode,
    // oxlint-disable-next-line typescript/no-explicit-any -- the caller types the values
    transform: ({ decode, encode }: Partial<TypeTransform<any, any, any, any>>) =>
      derive({
        encode: encode ? value => state.encode(encode(value)) : state.encode,
        decode: text => decode!(state.decode(text)),
      }),
    withParameters: (format: (...parameters: never[]) => string) =>
      derive({ formatSqlType: format }),
    // Type parameters change only the SQL type name, so the other changes of the type are kept.
    ...(formatSqlType && {
      with: (...parameters: never[]) => derive({ sqlType: formatSqlType(...parameters) }),
    }),
    nullable: () => derive({ isNullable: true }),
    // The narrowed values exist only in TypeScript.
    of: () => type,
  }) as unknown as AnyDerivableType
  return type
}

/** Encodes and decodes a value that is its PostgreSQL text representation. */
function keepText(text: string): string {
  return text
}
