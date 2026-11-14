import type { AnyExpression } from "../expression/expression"
import type { AnyType, TypeInput, TypeOutput } from "../type/type"

/** Kind of a key of a table: its primary key, or a unique key. */
export type KeyKind = "primaryKey" | "unique"

/**
 * Type that `primaryKey()` of a type or a column that accepts `null` is checked against, naming the reason.
 *
 * Without `strictNullChecks`, `null` belongs to every type, so every column looks nullable; the type then names the option instead.
 */
export type NullablePrimaryKey = null extends string ? StrictNullChecksRequired : NullableKeyColumn

/** Type that `NullablePrimaryKey` names for a column whose type is nullable. */
interface NullableKeyColumn {
  readonly "primary key columns must not be nullable": never
}

/** Type that `NullablePrimaryKey` names without `strictNullChecks`. */
interface StrictNullChecksRequired {
  readonly "kern-orm requires strictNullChecks": never
}

/**
 * Attributes that a column adds to its type in a table.
 *
 * `Key` is the kind of the key that the column forms alone, or `undefined` for none.
 */
export interface ColumnAttributes<Key extends KeyKind | undefined = KeyKind | undefined> {
  /** Physical column name; the column key is used when it is not set. */
  readonly name: string | undefined
  readonly keyKind: Key
  /** Whether the database gives the column a value when an insert omits it, such as by `DEFAULT` or an identity, as `hasDefault` marks it. */
  readonly hasDefault: boolean
  /** Value or expression that kern-orm inserts when an insert omits the column, or a function that returns it for each inserted record, as `default` gives it; `undefined` for none. */
  readonly default: unknown
}

/** Attributes of a column of a type without attributes. */
export const noColumnAttributes: ColumnAttributes<undefined> = /* @__PURE__ */ Object.freeze({
  name: undefined,
  keyKind: undefined,
  hasDefault: false,
  default: undefined,
})

declare const columnDefault: unique symbol

export type { columnDefault }

/**
 * Column of a table: a type with column attributes, forming a key of kind `Key` alone, or no key for `undefined`, which an insert may omit if `Default` is `true`, since it has a default of the database or of kern-orm.
 *
 * A column is not a type, so SQL fragments and parameters reject it; its methods add attributes and return a new column.
 */
export class Column<
  T extends AnyType,
  Key extends KeyKind | undefined = KeyKind | undefined,
  Default extends boolean = boolean,
> {
  /** Whether the column has a default of the database or of kern-orm, so that an insert may omit it; absent at runtime. */
  declare readonly [columnDefault]: Default

  constructor(
    readonly type: T,
    readonly attributes: ColumnAttributes<Key>,
  ) {
    Object.freeze(attributes)
    Object.freeze(this)
  }

  /** Uses a physical column name different from the column key. */
  columnName(name: string): Column<T, Key, Default> {
    return new Column(this.type, { ...this.attributes, name })
  }

  /** Marks the column as the primary key; the type must not be nullable. */
  primaryKey(
    this: null extends TypeInput<T> ? NullablePrimaryKey : Column<T, undefined, Default>,
  ): Column<T, "primaryKey", Default> {
    // `NullablePrimaryKey` only names why the types reject the call; `this` is always a column.
    return markKey(this as Column<T, undefined, Default>, "primaryKey")
  }

  /** Marks the column as a unique key. */
  unique(this: Column<T, undefined, Default>): Column<T, "unique", Default> {
    return markKey(this, "unique")
  }

  /** Marks the column as one that the database gives a value when an insert omits it, such as by `DEFAULT` or an identity, so that inserts may omit it. */
  hasDefault(): Column<T, Key, true> {
    return new Column(this.type, { ...this.attributes, hasDefault: true })
  }

  /**
   * Gives the column a default of kern-orm, so that inserts may omit it.
   *
   * `value` is a value of the type of the column, an expression of its values, such as a `sql` fragment, or a function that returns one.
   * An insert calls the function for each record that omits the column, each time it runs.
   * The default is inserted as a value of the record, so the database needs no default of its own.
   */
  default(value: ColumnDefault<TypeOutput<T>, TypeInput<T>>): Column<T, Key, true> {
    return new Column(this.type, { ...this.attributes, default: checkDefault(value) })
  }
}

/** Default of kern-orm of a column of values `Output` that accepts values `Input`: a value or an expression of the values, or a function that returns one for each inserted record. */
export type ColumnDefault<Output, Input> =
  | Input
  | AnyExpression<Output>
  | (() => Input | AnyExpression<Output>)

/** Returns `value` of `default`, rejecting `undefined`, which gives no default. */
export function checkDefault(value: unknown): unknown {
  if (value === undefined) {
    throw new TypeError(
      "default takes a value or a function that returns it, not undefined; omit default to insert the default of the database",
    )
  }
  return value
}

/** Creates a column of `column` that forms a key of kind `keyKind` alone, rejecting a column that already forms a key. */
function markKey<T extends AnyType, K extends KeyKind, D extends boolean>(
  column: Column<T, KeyKind | undefined, D>,
  keyKind: K,
): Column<T, K, D> {
  if (column.attributes.keyKind !== undefined) {
    throw new Error(
      `A column marked with ${column.attributes.keyKind}() cannot be marked with ${keyKind}()`,
    )
  }
  return new Column(column.type, { ...column.attributes, keyKind })
}

/** Column of any type. */
// oxlint-disable-next-line typescript/no-explicit-any -- any column regardless of its type
export type AnyColumn = Column<any>

/** Column of a column definition: the column itself, or a column of a type without attributes. */
export type ToColumn<D extends AnyType | AnyColumn> = D extends AnyColumn
  ? D
  : D extends AnyType
    ? Column<D, undefined, false>
    : never
