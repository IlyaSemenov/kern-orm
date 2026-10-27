import type { AnyType, TypeOutput } from "../type/type"

/** Kind of a key of a table: its primary key, or a unique key. */
export type KeyKind = "primaryKey" | "unique"

/** Attributes that a column adds to its type in a table; `Key` is the kind of the key that the column forms alone, or `undefined` for none. */
export interface ColumnAttributes<Key extends KeyKind | undefined = KeyKind | undefined> {
  /** Physical column name; the column key is used when it is not set. */
  readonly name: string | undefined
  readonly keyKind: Key
}

/**
 * Column of a table: a type with column attributes, forming a key of kind `Key` alone, or no key for `undefined`.
 *
 * A column is not a type, so SQL fragments and parameters reject it; its methods add attributes and return a new column.
 */
export class Column<T extends AnyType, Key extends KeyKind | undefined = KeyKind | undefined> {
  constructor(
    readonly type: T,
    readonly attributes: ColumnAttributes<Key>,
  ) {
    Object.freeze(attributes)
    Object.freeze(this)
  }

  /** Uses a physical column name different from the column key. */
  columnName(name: string): Column<T, Key> {
    return new Column(this.type, { ...this.attributes, name })
  }

  /** Marks the column as the primary key; the type must not be nullable. */
  primaryKey(
    this: null extends TypeOutput<T> ? never : Column<T, undefined>,
  ): Column<T, "primaryKey"> {
    return markKey(this, "primaryKey")
  }

  /** Marks the column as a unique key. */
  unique(this: Column<T, undefined>): Column<T, "unique"> {
    return markKey(this, "unique")
  }
}

/** Creates a column of `column` that forms a key of kind `keyKind` alone, rejecting a column that already forms a key. */
function markKey<T extends AnyType, K extends KeyKind>(
  column: Column<T>,
  keyKind: K,
): Column<T, K> {
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
    ? Column<D, undefined>
    : never
