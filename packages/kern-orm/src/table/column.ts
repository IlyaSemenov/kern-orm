import type { AnyType, TypeOutput } from "../type/type"

/** Kind of a key of a table: its primary key, or a unique key. */
export type KeyKind = "primaryKey" | "unique"

/**
 * Type that `primaryKey()` of a type or a column whose values may be `null` is checked against, naming the reason.
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
 * `Key` is the kind of the key that the column forms alone, or `undefined` for none, and `Default` tells whether the database gives the column a value when an insert omits it.
 */
export interface ColumnAttributes<
  Key extends KeyKind | undefined = KeyKind | undefined,
  Default extends boolean = boolean,
> {
  /** Physical column name; the column key is used when it is not set. */
  readonly name: string | undefined
  readonly keyKind: Key
  /** Whether the database gives the column a value when an insert omits it, such as by `DEFAULT` or an identity. */
  readonly hasDefault: Default
}

/**
 * Column of a table: a type with column attributes, forming a key of kind `Key` alone, or no key for `undefined`, with a value of the database when an insert omits it if `Default` is `true`.
 *
 * A column is not a type, so SQL fragments and parameters reject it; its methods add attributes and return a new column.
 */
export class Column<
  T extends AnyType,
  Key extends KeyKind | undefined = KeyKind | undefined,
  Default extends boolean = boolean,
> {
  constructor(
    readonly type: T,
    readonly attributes: ColumnAttributes<Key, Default>,
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
    this: null extends TypeOutput<T> ? NullablePrimaryKey : Column<T, undefined, Default>,
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
