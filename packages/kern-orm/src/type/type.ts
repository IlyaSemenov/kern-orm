import type {
  AcceptedNull,
  AcceptedValues,
  AnyDerivableCodec,
  CodecOptions,
  CodecTransform,
  codecValues,
  DerivableCodec,
  DerivableCodecWithParameters,
} from "../database/codec/codec"
import { defineCodec, isCodec } from "../database/codec/codec"
import type { AnyExpression, Expression } from "../expression/expression"
import { getType, toExpression, toNode } from "../expression/expression"
import type {
  MergeOperators,
  NoOperators,
  OperatorDefinitions,
} from "../expression/operators/definitions"
import { isGenericOperator } from "../expression/operators/generic"
import type { NullablePrimaryKey } from "../table/column"
import { Column } from "../table/column"

/** Runtime mark of types, which tells them apart from columns, codecs without operators, and other objects. */
const typeBrand = Symbol("kern-orm.type")

/**
 * SQL type: a PostgreSQL type, the JavaScript representation of its values, and the operators of its expressions.
 *
 * A type is a codec, shared by columns, parameters, and SQL expressions, so the same value is encoded and decoded identically everywhere.
 * In a table, a type is a column; `columnName`, `primaryKey`, `unique`, and `hasDefault` create a column of the type with these attributes.
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
  // The members of `Codec`, declared here rather than inherited, which would cost instantiations for each type derived in user code.
  /** Value types for type inference; absent at runtime. */
  readonly [codecValues]: { output: Output; input: Input }
  /** SQL type name used in DDL, such as `numeric` or `vector(1536)`. */
  readonly sqlType: string
  /**
   * SQL type name that `param` casts its parameters to, such as `numeric` for `numeric(10,2)`.
   *
   * It omits type parameters, so that their precision, scale, or length do not constrain a parameter.
   */
  readonly castType: string
  readonly isNullable: boolean
  /** Converts a non-null value to its PostgreSQL text representation; it does not read `this`. */
  readonly encode: (value: NonNullable<Input>) => string
  /** Converts a non-null PostgreSQL text representation to a value; it does not read `this`. */
  readonly decode: (text: string) => Exclude<Output, null>
  /** Operators of expressions of this type, in addition to `isNull` or replacing it. */
  readonly operators: Operators
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
  // `null` among the values that a type returns stands for `NULL`, as `coalesce` and operators read it, so `decode` cannot return it.
  // Nullability is read from the values that it accepts, where `null` is always `NULL`: those that it returns may be `unknown`, which includes `null`, as for JSON values.
  /**
   * Creates a type with another representation of the values of this type, keeping its SQL type, operators, and nullability.
   * An `encode` that takes `null` also makes the result nullable.
   *
   * `decode` receives the values that this type decodes from values other than `NULL`, including `undefined` that an earlier decoder returns, and returns a value other than `null`; `encode` returns values that this type encodes; `NULL` stays `null` without them.
   */
  transform<NewOutput extends {} | undefined, NewInput>(
    options: CodecTransform<Exclude<Output, null>, NonNullable<Input>, NewOutput, NewInput>,
  ): Type<
    NewOutput | AcceptedNull<NewInput | Input>,
    NewInput | AcceptedNull<Input>,
    Operators,
    Parameters
  >
  /** Creates a type that decodes the values of this type into another representation, other than `null`, and accepts the values that this type accepts. */
  transform<NewOutput extends {} | undefined>(options: {
    decode: (value: Exclude<Output, null>) => NewOutput
  }): Type<NewOutput | AcceptedNull<Input>, Input, Operators, Parameters>
  nullable(): Type<Output | null, Input | null, Operators, Parameters>
  /**
   * Narrows the values of this type to `T` in TypeScript, such as to a union of strings that a `CHECK` constraint allows, or to the shape of JSON values.
   *
   * The values are not validated at runtime. `T` must be among the values that this type both returns and accepts, and `nullable` keeps `null` apart from it.
   */
  of<T extends AcceptedValues<Exclude<Output, null>, Exclude<Input, null>>>(): Type<
    T | AcceptedNull<Input>,
    T | AcceptedNull<Input>,
    Operators,
    Parameters
  >
  /** Creates a column of this type with a physical name different from the column key. */
  columnName(name: string): Column<Type<Output, Input, Operators, Parameters>, undefined, false>
  /** Creates a primary key column of this type; the type must not be nullable. */
  primaryKey(
    this: null extends Input ? NullablePrimaryKey : Type<Output, Input, Operators, Parameters>,
  ): Column<Type<Output, Input, Operators, Parameters>, "primaryKey", false>
  /** Creates a column of this type that is a unique key. */
  unique(): Column<Type<Output, Input, Operators, Parameters>, "unique", false>
  /** Creates a column of this type that the database gives a value when an insert omits it, such as by `DEFAULT` or an identity, so that inserts may omit it. */
  hasDefault(): Column<Type<Output, Input, Operators, Parameters>, undefined, true>
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

/** Type of any values, operators, and parameters. */
// oxlint-disable-next-line typescript/no-explicit-any -- any type regardless of its value types, operators, and parameters
export type AnyType = Type<any, any, any, any>

/** Values that a type decodes. */
export type TypeOutput<T extends AnyType> = T[typeof codecValues]["output"]

/** Values that a type encodes. */
export type TypeInput<T extends AnyType> = T[typeof codecValues]["input"]

/** Operators of the expressions of a type. */
export type TypeOperators<T extends AnyType> = T["operators"]

// An overload of its own, since TypeScript 6 does not take every type for a derivable codec by its members.
/** Defines a type from `type`, keeping its values and PostgreSQL type parameters, without its operators. */
export function defineType<Output, Input, Parameters extends unknown[] | undefined>(
  // oxlint-disable-next-line typescript/no-explicit-any -- the operators of the type are left out
  type: Type<Output, Input, any, Parameters>,
): Type<Output, Input, NoOperators, Parameters>
/**
 * Defines a type from `codec`, such as a codec defined without kern-orm, keeping its values and PostgreSQL type parameters.
 *
 * Its expressions have only `isNull` until `withOperators` adds operators.
 */
export function defineType<Output, Input, Parameters extends unknown[] | undefined>(
  codec: DerivableCodec<Output, Input, Parameters>,
): Type<Output, Input, NoOperators, Parameters>
/**
 * Defines a type whose values are the PostgreSQL text representations as they are.
 *
 * `transform` converts them to other values, such as `number[]` for `vector`.
 */
export function defineType(
  // A codec has the members of the options, so the options are checked not to be one: a codec typed by its contract alone would otherwise give a type of strings.
  options: CodecOptions & { readonly [codecValues]?: NotADerivableCodec },
): Type<string>
export function defineType(definition: AnyDerivableCodec | CodecOptions): AnyType {
  const codec = isCodec(definition)
    ? (definition as AnyDerivableCodec)
    : defineCodec(definition as CodecOptions)
  return createType(codec, Object.freeze({}))
}

/** Type that the options of `defineType` are checked against when they are a codec typed without the methods that derive codecs, naming the reason. */
interface NotADerivableCodec {
  readonly "defineType takes a codec typed as a DerivableCodec, as defineCodec creates it": never
}

/** Tells whether `value` is a type, as opposed to a column, a codec without operators, or another object. */
export function isType(value: unknown): value is AnyType {
  return typeof value === "object" && value !== null && typeBrand in value
}

/** Derivable codec that has `with`, of any values and parameters. */
// oxlint-disable-next-line typescript/no-explicit-any -- any codec regardless of its value types
type CodecWithAnyParameters = DerivableCodecWithParameters<any, any, never[]>

/** Creates the type of the values of `codec` whose expressions have `operators`. */
function createType(codec: AnyDerivableCodec, operators: OperatorDefinitions): AnyType {
  // Each derivation derives the codec and gives the result the operators of this type.
  const derive = (derived: AnyDerivableCodec) => createType(derived, operators)
  const type: AnyType = Object.freeze({
    // The members of the codec with its brand, by which the database layer takes the type as a codec; `encode` and `decode` are the functions of the codec, without a call of the type for each value.
    ...codec,
    [typeBrand]: true,
    operators,
    withOperators(extra: OperatorDefinitions) {
      const merged: OperatorDefinitions = { ...operators }
      for (const name of Object.keys(extra)) {
        // `await` and `Promise.resolve` would call such an operator on any expression.
        if (name === "then") {
          throw new TypeError('Operator "then" is not allowed: it would make expressions thenable')
        }
        const operator = extra[name]!
        // `defineProperty` keeps operator names such as `__proto__` own properties.
        Object.defineProperty(merged, name, {
          value: isGenericOperator(operator)
            ? operator
            : (self: AnyExpression, ...args: unknown[]) =>
                operator(getType(self) === type ? self : toExpression(toNode(self), type), ...args),
          enumerable: true,
        })
      }
      return createType(codec, Object.freeze(merged))
    },
    // oxlint-disable-next-line typescript/no-explicit-any -- the caller types the values
    transform: (options: CodecTransform<any, any, any, any>) => derive(codec.transform(options)),
    withParameters: (format: (...parameters: never[]) => string) =>
      derive(codec.withParameters(format)),
    ...("with" in codec && {
      with: (...parameters: never[]) =>
        derive((codec as CodecWithAnyParameters).with(...parameters)),
    }),
    nullable: () => derive(codec.nullable()),
    // The narrowed values exist only in TypeScript.
    of: () => type,
    columnName: (name: string) => new Column(type, { name, keyKind: undefined, hasDefault: false }),
    primaryKey: () =>
      new Column(type, { name: undefined, keyKind: "primaryKey", hasDefault: false }),
    unique: () => new Column(type, { name: undefined, keyKind: "unique", hasDefault: false }),
    hasDefault: () => new Column(type, { name: undefined, keyKind: undefined, hasDefault: true }),
  }) as unknown as AnyType
  return type
}
