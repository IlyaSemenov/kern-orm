// Codecs: the contract by which the database layer converts the values of a PostgreSQL type, and the codecs that `defineCodec` creates.

declare const codecValues: unique symbol
// Exported so that a type declares the members of a codec without extending `Codec`, such as a type of a query builder.
export type { codecValues }

/** Runtime mark of codecs, which tells them apart from other objects with the same members. */
const codecBrand = Symbol("kern-db.codec")

/**
 * Codec of a PostgreSQL type: the SQL names of the type and the conversion between JavaScript values and their PostgreSQL text representation.
 *
 * `Output` are the values that it returns and `Input` those that it accepts, where `null` stands for `NULL`.
 * `defineCodec` creates a codec, and an object that copies the members of a codec is a codec too.
 */
export interface Codec<Output, Input = Output> {
  /** Value types for type inference; absent at runtime. */
  readonly [codecValues]: { output: Output; input: Input }
  /** SQL type name used in DDL, such as `numeric` or `vector(1536)`. */
  readonly sqlType: string
  /**
   * SQL type name that a parameter is cast to, such as `numeric` for `numeric(10,2)`.
   *
   * It omits type parameters, so that their precision, scale, or length do not constrain a parameter.
   */
  readonly castType: string
  readonly isNullable: boolean
  // A property of a function type rather than a method, whose parameters TypeScript compares bivariantly: a codec is not one of more accepted values.
  /** Converts a non-null value to its PostgreSQL text representation; it does not read `this`. */
  readonly encode: (value: NonNullable<Input>) => string
  /** Converts a non-null PostgreSQL text representation to a value; it does not read `this`. */
  readonly decode: (text: string) => Exclude<Output, null>
}

/** Codec of any values. */
// oxlint-disable-next-line typescript/no-explicit-any -- any codec regardless of its value types
export type AnyCodec = Codec<any, any>

/** Values that a codec returns. */
export type CodecOutput<C extends AnyCodec> = C[typeof codecValues]["output"]

/** Values that a codec accepts. */
export type CodecInput<C extends AnyCodec> = C[typeof codecValues]["input"]

/**
 * Codec that derives other codecs of its PostgreSQL type, as `defineCodec` creates it.
 *
 * A codec with PostgreSQL type parameters, such as the length of `varchar(255)`, has `with`.
 */
export type DerivableCodec<
  Output,
  Input = Output,
  Parameters extends unknown[] | undefined = undefined,
> = BaseDerivableCodec<Output, Input, Parameters> &
  (Parameters extends unknown[] ? DerivableCodecWithParameters<Output, Input, Parameters> : unknown)

/** Members of every derivable codec; see `DerivableCodec`. */
export interface BaseDerivableCodec<
  Output,
  Input,
  Parameters extends unknown[] | undefined,
> extends Codec<Output, Input> {
  /**
   * Creates a codec that accepts PostgreSQL type parameters with `with`.
   *
   * `format` returns the SQL type name with the parameters, such as `vector(1536)` for `1536`.
   */
  withParameters<P extends unknown[]>(
    format: (...parameters: P) => string,
  ): DerivableCodec<Output, Input, P>
  // `null` among the values that a codec returns stands for `NULL`, so `decode` cannot return it.
  // Nullability is read from the values that it accepts, where `null` is always `NULL`: those that it returns may be `unknown`, which includes `null`, as for JSON values.
  /**
   * Creates a codec with another representation of the values of this codec, keeping its SQL type and nullability.
   * An `encode` that takes `null` also makes the result nullable.
   *
   * `decode` receives the values that this codec decodes from values other than `NULL`, including `undefined` that an earlier decoder returns, and returns a value other than `null`; `encode` returns values that this codec encodes; `NULL` stays `null` without them.
   */
  transform<NewOutput extends {} | undefined, NewInput>(
    options: CodecTransform<Exclude<Output, null>, NonNullable<Input>, NewOutput, NewInput>,
  ): DerivableCodec<
    NewOutput | AcceptedNull<NewInput | Input>,
    NewInput | AcceptedNull<Input>,
    Parameters
  >
  /** Creates a codec that decodes the values of this codec into another representation, other than `null`, and accepts the values that this codec accepts. */
  transform<NewOutput extends {} | undefined>(options: {
    decode: (value: Exclude<Output, null>) => NewOutput
  }): DerivableCodec<NewOutput | AcceptedNull<Input>, Input, Parameters>
  /** Creates a codec whose values include `null`, which stands for `NULL`. */
  nullable(): DerivableCodec<Output | null, Input | null, Parameters>
  /**
   * Narrows the values of this codec to `T` in TypeScript, such as to a union of strings that a `CHECK` constraint allows, or to the shape of JSON values.
   *
   * The values are not validated at runtime. `T` must be among the values that this codec both returns and accepts, and `nullable` keeps `null` apart from it.
   */
  of<T extends AcceptedValues<Exclude<Output, null>, Exclude<Input, null>>>(): DerivableCodec<
    T | AcceptedNull<Input>,
    T | AcceptedNull<Input>,
    Parameters
  >
}

/** Members of a derivable codec with PostgreSQL type parameters; see `DerivableCodec`. */
export interface DerivableCodecWithParameters<Output, Input, Parameters extends unknown[]> {
  /** Creates this codec with PostgreSQL type parameters, such as `varchar.with(255)` for `varchar(255)`; other changes of the codec are kept. */
  with(...parameters: Parameters): DerivableCodec<Output, Input, Parameters>
}

/** Derivable codec of any values and parameters. */
// oxlint-disable-next-line typescript/no-explicit-any -- any codec regardless of its value types and parameters
export type AnyDerivableCodec = DerivableCodec<any, any, any>

/**
 * Values that `of` can narrow a codec to: those both among the values `O` that it returns and among the values `I` that it accepts, or `UnacceptedValues` when there are none.
 *
 * A narrowed value is also accepted, so its encoder must take it.
 */
// When one of the types contains the other, as the values of every built-in codec do, it stands for the intersection, which an error would show as `string | (string & Date)` for `timestamptz`.
export type AcceptedValues<O, I> = [O] extends [I]
  ? O
  : [I] extends [O]
    ? I
    : [O & I] extends [never]
      ? UnacceptedValues
      : O & I

/** `null` when the accepted values `I` include it, also as `unknown`; `never` otherwise. */
export type AcceptedNull<I> = null extends I ? null : never

/** Type that `AcceptedValues` names for a codec that accepts none of the values it returns. */
interface UnacceptedValues {
  readonly "of narrows only a type that accepts the values it returns": never
}

/** Conversion between the values of a codec and their new representation. */
export interface CodecTransform<Output, Input, NewOutput, NewInput> {
  decode: (value: Output) => NewOutput
  encode: (value: NewInput) => Input
}

/** Codec definition. */
export interface CodecOptions {
  /** SQL type name, such as `ltree`; `withParameters` adds type parameters to it, and a name with them requires `castType`. */
  sqlType: string
  /** SQL type name that parameters are cast to when `sqlType` constrains values, such as `bpchar` for `char`, whose length is 1. */
  castType?: string
}

/**
 * Defines a codec whose values are the PostgreSQL text representations as they are.
 *
 * `transform` converts them to other values, such as `number[]` for `vector`.
 */
export function defineCodec(
  // A codec has the members of the options, so the options are checked not to be one: it would give a codec of strings of its SQL type, without its conversion and nullability.
  options: CodecOptions & { readonly [codecValues]?: NotCodecOptions },
): DerivableCodec<string> {
  if (isCodec(options)) {
    throw new TypeError(
      "defineCodec() takes options, not a codec or a type, which is a codec already",
    )
  }
  // Casting a parameter to type parameters would apply their precision, scale, or length to it.
  if (options.castType === undefined && options.sqlType.includes("(")) {
    throw new TypeError(
      `Define the type parameters of "${options.sqlType}" using withParameters(), or set castType`,
    )
  }
  return createCodec({
    sqlType: options.sqlType,
    castType: options.castType ?? options.sqlType,
    encode: keepText,
    decode: keepText,
    isNullable: false,
    formatSqlType: undefined,
  })
}

/** Type that the options of `defineCodec` are checked against when they are a codec or a type, naming the reason. */
interface NotCodecOptions {
  readonly "defineCodec takes options, not a codec or a type, which is a codec already": never
}

/** Tells whether `value` is a codec, including an object that copies the members of one. */
export function isCodec(value: unknown): value is AnyCodec {
  return typeof value === "object" && value !== null && codecBrand in value
}

interface CodecState {
  readonly sqlType: string
  readonly castType: string
  // oxlint-disable-next-line typescript/no-explicit-any -- the caller types the values
  readonly encode: (value: any) => string
  readonly decode: (text: string) => unknown
  readonly isNullable: boolean
  /** Formats the SQL type name with type parameters; codecs without parameters have none. */
  readonly formatSqlType: ((...parameters: never[]) => string) | undefined
}

function createCodec(state: CodecState): AnyDerivableCodec {
  const derive = (changes: Partial<CodecState>) => createCodec({ ...state, ...changes })
  const { formatSqlType } = state
  // The brand and the members are own enumerable properties, so that an object that copies them, with members of its own, is a codec.
  const codec: AnyDerivableCodec = Object.freeze({
    [codecBrand]: true,
    sqlType: state.sqlType,
    castType: state.castType,
    isNullable: state.isNullable,
    encode: state.encode,
    decode: state.decode,
    // oxlint-disable-next-line typescript/no-explicit-any -- the caller types the values
    transform: ({ decode, encode }: Partial<CodecTransform<any, any, any, any>>) =>
      derive({
        encode: encode ? value => state.encode(encode(value)) : state.encode,
        decode: text => decode!(state.decode(text)),
      }),
    withParameters: (format: (...parameters: never[]) => string) =>
      derive({ formatSqlType: format }),
    // Type parameters change only the SQL type name, so the other changes of the codec are kept.
    ...(formatSqlType && {
      with: (...parameters: never[]) => derive({ sqlType: formatSqlType(...parameters) }),
    }),
    nullable: () => derive({ isNullable: true }),
    // The narrowed values exist only in TypeScript.
    of: () => codec,
  }) as unknown as AnyDerivableCodec
  return codec
}

/** Encodes and decodes a value that is its PostgreSQL text representation. */
function keepText(text: string): string {
  return text
}
