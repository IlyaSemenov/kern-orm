import type {
  AcceptedNull,
  AcceptedValues,
  AnyDerivableType,
  DerivableType,
  DerivableTypeWithParameters,
  TypeOptions,
  TypeTransform,
  typeValues,
} from "kern-db"
import { defineType as defineDbType, isType as isDbType } from "kern-db"

import type { AnyExpression, Expression } from "../expression/expression"
import { getType, toExpression, toNode } from "../expression/expression"
import type {
  MergeOperators,
  NoOperators,
  OperatorDefinitions,
} from "../expression/operators/definitions"
import { isGenericOperator } from "../expression/operators/generic"
import type { ColumnDefault, NullablePrimaryKey } from "../table/column"
import { checkDefault, Column, noColumnAttributes } from "../table/column"

/** Runtime mark of types, which tells them apart from columns, types of kern-db without operators, and other objects. */
const typeBrand = Symbol("kern-orm.type")

/**
 * SQL type: a PostgreSQL type, the JavaScript representation of its values, and the operators of its expressions.
 *
 * A type is a type of kern-db, shared by columns, parameters, and SQL expressions, so the same value is encoded and decoded identically everywhere.
 * In a table, a type is a column; `columnName`, `primaryKey`, `unique`, `hasDefault`, and `default` create a column of the type with these attributes.
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
  // The members of `Type` of kern-db, declared here rather than inherited, which would cost instantiations for each type derived in user code.
  /** Value types for type inference; absent at runtime. */
  readonly [typeValues]: { output: Output; input: Input }
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
    options: TypeTransform<Exclude<Output, null>, NonNullable<Input>, NewOutput, NewInput>,
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
   * The values are not validated at runtime.
   * `T` must be among the values that this type both returns and accepts, and `nullable` keeps `null` apart from it.
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
  /**
   * Creates a column of this type with a default of kern-orm, so that inserts may omit it.
   *
   * `value` is a value of this type, an expression of its values, such as a `sql` fragment, or a function that returns one.
   * An insert calls the function for each record that omits the column, each time it runs.
   * The default is inserted as a value of the record, so the database needs no default of its own.
   */
  default(
    value: ColumnDefault<Output, Input>,
  ): Column<Type<Output, Input, Operators, Parameters>, undefined, true>
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
export type TypeOutput<T extends AnyType> = T[typeof typeValues]["output"]

/** Values that a type encodes. */
export type TypeInput<T extends AnyType> = T[typeof typeValues]["input"]

/** Operators of the expressions of a type. */
export type TypeOperators<T extends AnyType> = T["operators"]

// An overload of its own, since TypeScript 6 does not take every type for a derivable type of kern-db by its members.
/** Defines a type from `type`, keeping its values and PostgreSQL type parameters, without its operators. */
export function defineType<Output, Input, Parameters extends unknown[] | undefined>(
  // oxlint-disable-next-line typescript/no-explicit-any -- the operators of the type are left out
  type: Type<Output, Input, any, Parameters>,
): Type<Output, Input, NoOperators, Parameters>
/**
 * Defines a type from `dbType`, a type of kern-db, such as one defined without kern-orm, keeping its values and PostgreSQL type parameters.
 *
 * Its expressions have only `isNull` until `withOperators` adds operators.
 */
export function defineType<Output, Input, Parameters extends unknown[] | undefined>(
  dbType: DerivableType<Output, Input, Parameters>,
): Type<Output, Input, NoOperators, Parameters>
/**
 * Defines a type whose values are the PostgreSQL text representations as they are.
 *
 * `transform` converts them to other values, such as `number[]` for `vector`.
 */
export function defineType(
  // A type of kern-db has the members of the options, so the options are checked not to be one: a type typed by its contract alone would otherwise give a type of strings.
  options: TypeOptions & { readonly [typeValues]?: NotADerivableType },
): Type<string>
export function defineType(definition: AnyDerivableType | TypeOptions): AnyType {
  const dbType = isDbType(definition)
    ? (definition as AnyDerivableType)
    : defineDbType(definition as TypeOptions)
  return createType(dbType, Object.freeze({}))
}

/** Type that the options of `defineType` are checked against when they are a type of kern-db typed without the methods that derive types, naming the reason. */
interface NotADerivableType {
  readonly "defineType takes a type of kern-db typed as a DerivableType, as defineType of kern-db creates it": never
}

/** Tells whether `value` is a type, as opposed to a column, a type of kern-db without operators, or another object. */
export function isType(value: unknown): value is AnyType {
  return typeof value === "object" && value !== null && typeBrand in value
}

/**
 * Describes `value`, which a function that takes a type rejected as not a type, for its error: a type of kern-db, which has no operators, with the hints of `kern-orm/types` and `defineType`.
 *
 * It returns `undefined` for a value that is not a type of kern-db; a type of kern-orm is one too, so the caller rejects only values other than types.
 */
export function describeRejectedDbType(value: unknown): string | undefined {
  return isDbType(value)
    ? "a type of kern-db, which has no operators; take a built-in type from kern-orm/types, or create a type from it with defineType() of kern-orm"
    : undefined
}

/** Derivable type of kern-db that has `with`, of any values and parameters. */
// oxlint-disable-next-line typescript/no-explicit-any -- any type regardless of its value types
type DbTypeWithAnyParameters = DerivableTypeWithParameters<any, any, never[]>

/** Creates the type of the values of `dbType` whose expressions have `operators`. */
function createType(dbType: AnyDerivableType, operators: OperatorDefinitions): AnyType {
  // Each derivation derives the type of kern-db and gives the result the operators of this type.
  const derive = (derived: AnyDerivableType) => createType(derived, operators)
  const type: AnyType = Object.freeze({
    // The members of the type of kern-db with its brand, by which the database layer takes the type as its own; `encode` and `decode` are the functions of that type, without a call of this type for each value.
    ...dbType,
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
      return createType(dbType, Object.freeze(merged))
    },
    // oxlint-disable-next-line typescript/no-explicit-any -- the caller types the values
    transform: (options: TypeTransform<any, any, any, any>) => derive(dbType.transform(options)),
    withParameters: (format: (...parameters: never[]) => string) =>
      derive(dbType.withParameters(format)),
    ...("with" in dbType && {
      with: (...parameters: never[]) =>
        derive((dbType as DbTypeWithAnyParameters).with(...parameters)),
    }),
    nullable: () => derive(dbType.nullable()),
    // The narrowed values exist only in TypeScript.
    of: () => type,
    columnName: (name: string) => new Column(type, { ...noColumnAttributes, name }),
    primaryKey: () => new Column(type, { ...noColumnAttributes, keyKind: "primaryKey" }),
    unique: () => new Column(type, { ...noColumnAttributes, keyKind: "unique" }),
    hasDefault: () => new Column(type, { ...noColumnAttributes, hasDefault: true }),
    default: (value: unknown) =>
      new Column(type, { ...noColumnAttributes, default: checkDefault(value) }),
  }) as unknown as AnyType
  return type
}
