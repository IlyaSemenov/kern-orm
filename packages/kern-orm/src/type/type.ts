import type { AnyExpression, Expression } from "../expression/expression"
import { getType, toExpression, toNode } from "../expression/expression"
import type {
  MergeOperators,
  NoOperators,
  OperatorDefinitions,
} from "../expression/operators/definitions"
import { isGenericOperator } from "../expression/operators/generic"
import { Column } from "../table/column"

declare const typeValues: unique symbol

/** Runtime mark of types, which tells them apart from columns and other objects. */
const typeBrand = Symbol("kern-orm.type")

/**
 * SQL type: a PostgreSQL type, the JavaScript representation of its values, and the operators of its expressions.
 *
 * A type is shared by columns, parameters, and SQL expressions, so the same value is encoded and decoded identically everywhere.
 * In a table, a type is a column; `columnName`, `primaryKey`, and `unique` create a column of the type with these attributes.
 * A type with PostgreSQL type parameters, such as the length of `varchar(255)`, has `with`.
 */
export type Type<
  Output,
  Input = Output,
  Operators extends OperatorDefinitions = NoOperators,
  Parameters extends unknown[] | undefined = undefined,
> = BaseType<Output, Input, Operators, Parameters> &
  (Parameters extends unknown[]
    ? TypeWithParameters<Output, Input, Operators, Parameters>
    : unknown)

/** Members of every type; see `Type`. */
export interface BaseType<
  Output,
  Input,
  Operators extends OperatorDefinitions,
  Parameters extends unknown[] | undefined,
> {
  readonly [typeBrand]: true
  /** Value types for type inference; absent at runtime. */
  readonly [typeValues]: { output: Output; input: Input; operators: Operators }
  /** SQL type name used in DDL, such as `numeric` or `vector(1536)`. */
  readonly sqlType: string
  /**
   * SQL type name that `param` casts its parameters to, such as `numeric` for `numeric(10,2)`.
   *
   * It omits type parameters, so that their precision, scale, or length do not constrain a parameter.
   */
  readonly castType: string
  /** Operators of expressions of this type, in addition to `isNull` or replacing it. */
  readonly operators: Operators
  readonly isNullable: boolean
  /** Converts a non-null value to its PostgreSQL text representation. */
  encode(value: NonNullable<Input>): string
  /** Converts a non-null PostgreSQL text representation to a value. */
  decode(text: string): NonNullable<Output>
  /**
   * Creates a type whose expressions also have `operators`.
   *
   * An operator replaces a base or previously added operator with the same name.
   * An operator defined as a function receives expressions of this type, as typed, even on the types derived from the created one, so that its arguments keep the encoding of this type.
   * A generic operator from `defineGenericOperator`, such as `lt` of `orderingOperators`, receives the expression with its own type instead.
   * An operator must not be named `then`, which would make expressions thenable.
   */
  withOperators<O extends OperatorDefinitions<Expression<Output, Operators, Input>>>(
    // One set rather than a rest parameter of several: TypeScript cannot both type `self` of inline operators and reject spreading an array of unknown length, whose operators the result type would miss.
    // Tried: a rest tuple (misses an array tail), a conditional or intersected rest type, and optional parameters with defaults (both lose `self`); overloads for a fixed count are arbitrary.
    // Sets are combined with spread, `{ ...orderingOperators, ...textOperators }`, or chained calls.
    operators: O,
  ): Type<Output, Input, MergeOperators<Operators, O>, Parameters>
  /**
   * Creates a type that accepts PostgreSQL type parameters with `with`.
   *
   * `format` returns the SQL type name with the parameters, such as `vector(1536)` for `1536`.
   */
  withParameters<P extends unknown[]>(
    format: (...parameters: P) => string,
  ): Type<Output, Input, Operators, P>
  /**
   * Creates a type with another representation of the values of this type, keeping its SQL type, operators, and nullability.
   *
   * `decode` receives decoded non-null values of this type, and `encode` returns values that this type encodes; `null` stays `null`.
   */
  transform<NewOutput, NewInput>(
    options: TypeTransform<NonNullable<Output>, NonNullable<Input>, NewOutput, NewInput>,
  ): Type<NewOutput | Extract<Output, null>, NewInput | Extract<Input, null>, Operators, Parameters>
  /** Creates a type that decodes the values of this type into another representation and accepts the values that this type accepts. */
  transform<NewOutput>(options: {
    decode: (value: NonNullable<Output>) => NewOutput
  }): Type<NewOutput | Extract<Output, null>, Input, Operators, Parameters>
  nullable(): Type<Output | null, Input | null, Operators, Parameters>
  /** Creates a column of this type with a physical name different from the column key. */
  columnName(name: string): Column<Type<Output, Input, Operators, Parameters>, undefined>
  /** Creates a primary key column of this type; the type must not be nullable. */
  primaryKey(
    this: null extends Output ? never : Type<Output, Input, Operators, Parameters>,
  ): Column<Type<Output, Input, Operators, Parameters>, "primaryKey">
  /** Creates a column of this type that is a unique key. */
  unique(): Column<Type<Output, Input, Operators, Parameters>, "unique">
}

/** Members of a type with PostgreSQL type parameters; see `Type`. */
export interface TypeWithParameters<
  Output,
  Input,
  Operators extends OperatorDefinitions,
  Parameters extends unknown[],
> {
  /** Creates this type with PostgreSQL type parameters, such as `varchar.with(255)` for `varchar(255)`; other changes of the type are kept. */
  with(...parameters: Parameters): Type<Output, Input, Operators, Parameters>
}

/** Conversion between the values of a type and their new representation. */
export interface TypeTransform<Output, Input, NewOutput, NewInput> {
  decode: (value: Output) => NewOutput
  encode: (value: NewInput) => Input
}

/** Type of any values, operators, and parameters. */
// oxlint-disable-next-line typescript/no-explicit-any -- any type regardless of its value types, operators, and parameters
export type AnyType = Type<any, any, any, any>

/** PostgreSQL text representation of a value, as types encode and decode it; `null` is SQL `NULL`. */
export type TextValue = string | null

/** Values that a type decodes. */
export type TypeOutput<T extends AnyType> = T[typeof typeValues]["output"]

/** Values that a type encodes. */
export type TypeInput<T extends AnyType> = T[typeof typeValues]["input"]

/** Operators of the expressions of a type. */
export type TypeOperators<T extends AnyType> = T[typeof typeValues]["operators"]

/** Type definition. */
export interface TypeOptions {
  /** SQL type name, such as `ltree`; `withParameters` adds type parameters to it, and a name with them requires `castType`. */
  sqlType: string
  /** SQL type name that `param` casts parameters to when `sqlType` constrains values, such as `bpchar` for `char`, whose length is 1. */
  castType?: string
}

/**
 * Defines a type whose values are the PostgreSQL text representations as they are.
 *
 * `transform` converts them to other values, such as `number[]` for `vector`.
 */
export function defineType(options: TypeOptions): Type<string> {
  // Casting a parameter to type parameters would apply their precision, scale, or length to it.
  if (options.castType === undefined && options.sqlType.includes("(")) {
    throw new TypeError(
      `Define the type parameters of "${options.sqlType}" using withParameters(), or set castType`,
    )
  }
  return createType({
    sqlType: options.sqlType,
    castType: options.castType ?? options.sqlType,
    encode: (value: string) => value,
    decode: text => text,
    operators: Object.freeze({}),
    isNullable: false,
    formatSqlType: undefined,
  })
}

/** Tells whether `value` is a type, as opposed to a column or another object. */
export function isType(value: unknown): value is AnyType {
  return typeof value === "object" && value !== null && typeBrand in value
}

interface TypeState {
  readonly sqlType: string
  readonly castType: string
  // oxlint-disable-next-line typescript/no-explicit-any -- the caller types the values
  readonly encode: (value: any) => string
  readonly decode: (text: string) => unknown
  readonly operators: OperatorDefinitions
  readonly isNullable: boolean
  /** Formats the SQL type name with type parameters; types without parameters have none. */
  readonly formatSqlType: ((...parameters: never[]) => string) | undefined
}

function createType(state: TypeState): AnyType {
  const derive = (changes: Partial<TypeState>) => createType({ ...state, ...changes })
  const { formatSqlType } = state
  const type: AnyType = Object.freeze({
    ...state,
    [typeBrand]: true,
    withOperators(extra: OperatorDefinitions) {
      const operators: OperatorDefinitions = { ...state.operators }
      for (const name of Object.keys(extra)) {
        // `await` and `Promise.resolve` would call such an operator on any expression.
        if (name === "then") {
          throw new TypeError('Operator "then" is not allowed: it would make expressions thenable')
        }
        const operator = extra[name]!
        // `defineProperty` keeps operator names such as `__proto__` own properties.
        Object.defineProperty(operators, name, {
          value: isGenericOperator(operator)
            ? operator
            : (self: AnyExpression, ...args: unknown[]) =>
                operator(getType(self) === type ? self : toExpression(toNode(self), type), ...args),
          enumerable: true,
        })
      }
      return derive({ operators: Object.freeze(operators) })
    },
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
    columnName: (name: string) => new Column(type, { name, keyKind: undefined }),
    primaryKey: () => new Column(type, { name: undefined, keyKind: "primaryKey" }),
    unique: () => new Column(type, { name: undefined, keyKind: "unique" }),
  }) as unknown as AnyType
  return type
}
