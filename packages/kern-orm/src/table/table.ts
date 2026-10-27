import { isRecordKey } from "../result/result"
import type { AnyType, TypeInput, TypeOperators, TypeOutput } from "../type/type"
import { isType } from "../type/type"
import type { IsUnion } from "../utils/type-helpers"

import type { AnyColumn, ToColumn } from "./column"
import { Column } from "./column"

/** Column definitions by their keys: types or columns; a key must not start with `$`, which is reserved for members of column references in queries. */
export type ColumnDefinitions = Record<string, AnyType | AnyColumn>

/** Columns by their keys. */
export type ColumnShape = Record<string, AnyColumn>

/** Columns of column definitions, with a column of every type without attributes. */
export type ToColumns<D extends ColumnDefinitions> = { [K in keyof D]: ToColumn<D[K]> }

/** Column keys of a key of a table, in its order. */
export type KeyColumns = readonly [string, ...string[]]

declare const keysType: unique symbol

/**
 * Keys of a table: its primary key, or `undefined` without one, and its other unique keys.
 *
 * This type does not tell which keys a table has, such as for a table typed as `Table<Name, Columns>`; `TableKeys` does.
 */
export interface AnyTableKeys {
  readonly primaryKey: KeyColumns | undefined
  readonly unique: readonly KeyColumns[]
}

/** Keys of a table that its type tells: primary key `PrimaryKey`, or `undefined` without one, and each unique key of `UniqueKey`. */
export interface TableKeys<
  PrimaryKey extends KeyColumns | undefined,
  UniqueKey extends KeyColumns,
> extends AnyTableKeys {
  // The keys are typed only here, so that the intersection with `AnyTableKeys`, which the `this` types of query methods give, compares no tuples.
  // Invariant, as both parameters and the result, and required, so that no assignment gives a table more or fewer keys, which relations trust.
  readonly [keysType]: (
    primaryKey: PrimaryKey,
    unique: UniqueKey,
  ) => readonly [PrimaryKey, UniqueKey]
}

/**
 * Immutable table descriptor: physical name, columns, and keys.
 *
 * A table knows nothing about relations, schemas, or database connections, so the same table can belong to several schemas.
 * Its object identity is the logical identity of the table.
 */
export interface Table<
  Name extends string = string,
  Columns extends ColumnShape = ColumnShape,
  Keys extends AnyTableKeys = AnyTableKeys,
> {
  readonly kind: "table"
  readonly name: Name
  readonly columns: Columns
  readonly keys: Keys
}

/** Table of any name, columns, and keys. */
export type AnyTable = Table<string, ColumnShape>

/**
 * Options of `defineTable` over column keys `Column`: the keys of several columns, whose columns are listed in their order.
 *
 * The columns of the primary key are of `PrimaryKeyColumn`.
 */
export interface TableOptions<
  Column extends string = string,
  PrimaryKeyColumn extends string = Column,
> {
  /** Columns of a primary key of several columns; mark a primary key of one column with `primaryKey()`. */
  readonly primaryKey?: readonly [PrimaryKeyColumn, PrimaryKeyColumn, ...PrimaryKeyColumn[]]
  /** Unique keys of several columns; mark a unique key of one column with `unique()`. */
  readonly unique?: readonly (readonly [Column, Column, ...Column[]])[]
}

/** Record shape returned when all columns of a table are selected. */
export type Selectable<T extends AnyTable> = {
  [K in keyof T["columns"]]: TypeOutput<T["columns"][K]["type"]>
}

/** Input values of the types of the columns. */
export type ColumnValues<T extends AnyTable> = {
  [K in keyof T["columns"]]: TypeInput<T["columns"][K]["type"]>
}

/** Operators of the expressions of a column. */
export type ColumnOperators<T extends AnyTable, K extends keyof T["columns"]> = TypeOperators<
  T["columns"][K]["type"]
>

/**
 * Tells whether columns `Columns`, a union of column keys, are exactly a key of table `T`, primary or unique, in any order.
 *
 * It is `boolean` when the type of `T` does not tell its keys.
 * A union of tables, or of their keys, gives the union of their results.
 */
export type IsKey<T extends AnyTable, Columns> = T extends AnyTable
  ? KeysResult<T["keys"], Columns, "exact">
  : never

/** Tells whether columns `Columns`, a union of column keys, include a key of table `T`, primary or unique, as `IsKey` tells its results. */
export type ContainsKey<T extends AnyTable, Columns> = T extends AnyTable
  ? KeysResult<T["keys"], Columns, "included">
  : never

// Only a type with the required member of `TableKeys` tells the keys, so a type that drops it, such as `Pick` of `primaryKey` and `unique`, tells none.
/** Tells for each of keys `K` whether a key of them, primary or unique, matches columns `Columns` as `Match` tells: `"exact"` or `"included"`; `boolean` for keys whose type does not tell them. */
type KeysResult<K extends AnyTableKeys, Columns, Match> =
  K extends TableKeys<infer PrimaryKey, infer UniqueKey>
    ? [
        Match extends "exact"
          ? MatchingKey<NonNullable<PrimaryKey> | UniqueKey, Columns>
          : IncludedKey<NonNullable<PrimaryKey> | UniqueKey, Columns>,
      ] extends [never]
      ? false
      : true
    : boolean

/** Union of the primary key and the unique keys of keys `K` of a table, or `never` where the type of `K` does not tell them. */
export type KeyOf<K extends AnyTableKeys> =
  K extends TableKeys<infer PrimaryKey, infer UniqueKey>
    ? NonNullable<PrimaryKey> | UniqueKey
    : never

/** `true` for each key of `Key` whose columns are exactly `Columns`. */
type MatchingKey<Key, Columns> = Key extends KeyColumns
  ? [Key[number]] extends [Columns]
    ? [Columns] extends [Key[number]]
      ? true
      : never
    : never
  : never

/** `true` for each key of `Key` whose columns are among `Columns`. */
type IncludedKey<Key, Columns> = Key extends KeyColumns
  ? [Key[number]] extends [Columns]
    ? true
    : never
  : never

/** Column key of columns `C` as a string, as object keys are at runtime. */
type ColumnKey<C extends ColumnShape> = `${keyof C & (string | number)}`

/** Column key of columns `C` whose type is not nullable, as a string like `ColumnKey`. */
type NonNullableColumnKey<C extends ColumnShape> = {
  [K in keyof C]: null extends TypeOutput<C[K]["type"]> ? never : `${K & (string | number)}`
}[keyof C]

/** Column key of columns `C`, as a string like `ColumnKey`, whose column forms a key of kind `Kind` alone, as `KnownKeyKind` tells. */
type KeyedColumn<C extends ColumnShape, Kind> = {
  [K in keyof C]: KnownKeyKind<C[K]["attributes"]["keyKind"]> extends Kind
    ? `${K & (string | number)}`
    : never
}[keyof C]

/** Kind `Kind` of the key that a column forms alone, or `"unknown"` where the type of the column does not tell it. */
type KnownKeyKind<Kind> = [Kind] extends [undefined]
  ? undefined
  : [Kind] extends ["primaryKey"]
    ? "primaryKey"
    : [Kind] extends ["unique"]
      ? "unique"
      : "unknown"

/** Column keys that the primary key in the options of a table of columns `C` may list: none when a column is marked with `primaryKey()`. */
type PrimaryKeyOption<C extends ColumnShape> = [KeyedColumn<C, "primaryKey">] extends [never]
  ? NonNullableColumnKey<C>
  : never

/**
 * Keys of a table of columns `C` and options `O`, as `defineTable` defines them, or `AnyTableKeys` where the types do not tell them.
 *
 * The types do not tell them for a column whose type does not tell its key, such as `Column<T>`, for several columns marked with `primaryKey()`, which `defineTable` rejects, and for options whose keys are not tuples of single column keys, such as a variable of type `TableOptions` or a union in a key or in the list of unique keys.
 * A union of options, which may include `undefined`, gives the union of their keys.
 */
type DefinedKeys<C extends ColumnShape, O> = O extends unknown
  ? [KeyedColumn<C, "unknown">] extends [never]
    ? true extends IsUnion<KeyedColumn<C, "primaryKey">>
      ? AnyTableKeys
      : KeysOf<C, OptionPrimaryKey<O>, OptionUniqueKey<O>>
    : AnyTableKeys
  : never

/** Keys of a table of columns `C` with primary key `PrimaryKey` and unique keys `UniqueKey` of its options, which are `"unknown"` where their types do not tell them. */
type KeysOf<C extends ColumnShape, PrimaryKey, UniqueKey> = "unknown" extends PrimaryKey | UniqueKey
  ? AnyTableKeys
  : KnownKeysOf<DefinedPrimaryKey<C, PrimaryKey>, DefinedUniqueKey<C, UniqueKey>>

// TypeScript defers a reference to `TableKeys` or a tuple whose arguments are aliases or conditional types, or that is the whole body of an alias, and `infer` leaves a type parameter for `never`; each makes the type of a table generic, which TypeScript instantiates again with every mapper, such as on each `$execute`.
/** Keys that a table type tells, with its primary key and unique keys computed before they become arguments of `TableKeys`. */
type KnownKeysOf<PrimaryKey extends KeyColumns | undefined, UniqueKey extends KeyColumns> = [
  PrimaryKey,
] extends [unknown]
  ? TableKeys<PrimaryKey, UniqueKey>
  : never

/** Primary key of a table of columns `C`: `PrimaryKey` of its options, or of the column marked with `primaryKey()`, or `undefined`. */
type DefinedPrimaryKey<C extends ColumnShape, PrimaryKey> = PrimaryKey extends KeyColumns
  ? PrimaryKey
  : [KeyedColumn<C, "primaryKey">] extends [never]
    ? undefined
    : SingleColumnKey<KeyedColumn<C, "primaryKey">>

/** Unique key of a table of columns `C`: `UniqueKey` of its options, or of a column marked with `unique()`. */
type DefinedUniqueKey<C extends ColumnShape, UniqueKey> =
  | Extract<UniqueKey, KeyColumns>
  | SingleColumnKey<KeyedColumn<C, "unique">>

/** Key of each single column of `K`. */
type SingleColumnKey<K> = K extends string ? readonly [K] : never

// TypeScript adds a member of type `undefined` to an object literal of a union that lacks it, so such a member is absent.
/** Primary key in options `O`: `undefined` without one, or `"unknown"` where its type does not tell it. */
type OptionPrimaryKey<O> = [O["primaryKey" & keyof O]] extends [undefined]
  ? undefined
  : O extends { readonly primaryKey: infer Key }
    ? IsExactKey<Key> extends true
      ? Key
      : "unknown"
    : "unknown"

/** Unique key in options `O`, `never` without them, or `"unknown"` where their type does not tell them. */
type OptionUniqueKey<O> = [O["unique" & keyof O]] extends [undefined]
  ? never
  : O extends { readonly unique: infer Keys extends readonly unknown[] }
    ? true extends IsUnion<Keys>
      ? "unknown"
      : number extends Keys["length"]
        ? "unknown"
        : true extends {
              [I in keyof Keys]: IsExactKey<Keys[I]> extends true ? false : true
            }[number]
          ? "unknown"
          : Keys[number]
    : "unknown"

/** Tells whether key `K` is one tuple of fixed length with one column key in each position, rather than a union. */
export type IsExactKey<K> =
  true extends IsUnion<K>
    ? false
    : K extends readonly unknown[]
      ? number extends K["length"]
        ? false
        : true extends { [I in keyof K]: IsUnion<K[I]> }[number]
          ? false
          : true
      : false

/**
 * Defines a table; a type without column attributes becomes a column as it is.
 *
 * A key of one column is marked on its column.
 */
export function defineTable<Name extends string, Definitions extends ColumnDefinitions>(
  name: Name,
  definitions: Definitions,
): Table<Name, ToColumns<Definitions>, DefinedKeys<ToColumns<Definitions>, undefined>>
// A required parameter, rather than an optional one, keeps `undefined` of an argument such as `flag ? options : undefined` in `Options`, so that its keys are not taken for certain.
/**
 * Defines a table; a type without column attributes becomes a column as it is.
 *
 * A key of one column is marked on its column, and `options` list the columns of the keys of several columns.
 */
export function defineTable<
  Name extends string,
  Definitions extends ColumnDefinitions,
  const Options extends
    | TableOptions<ColumnKey<ToColumns<Definitions>>, PrimaryKeyOption<ToColumns<Definitions>>>
    | undefined,
>(
  name: Name,
  definitions: Definitions,
  options: Options,
): Table<Name, ToColumns<Definitions>, DefinedKeys<ToColumns<Definitions>, Options>>
export function defineTable(
  name: string,
  definitions: ColumnDefinitions,
  options?: TableOptions,
): AnyTable {
  const columns: ColumnShape = {}
  for (const [key, definition] of Object.entries(definitions)) {
    if (key.startsWith("$")) {
      throw new Error(`Column key "${key}" of table "${name}" must not start with "$"`)
    }
    if (!isRecordKey(key)) {
      throw new Error(
        `Column key "__proto__" of table "${name}" is not allowed; use columnName("__proto__")`,
      )
    }
    const column = toColumn(definition)
    if (!column) {
      throw new TypeError(`Column "${key}" of table "${name}" must be a type or a column`)
    }
    columns[key] = column
  }
  return Object.freeze({
    kind: "table",
    name,
    columns: Object.freeze(columns),
    keys: defineKeys(name, columns, options),
  })
}

/**
 * Defines the keys of table `name` of `columns` from the keys marked on the columns and those of `options`.
 *
 * The unique keys are those of the columns in their order, followed by those of the options.
 * It rejects a primary key declared twice, a key of the options with fewer than two columns, an unknown column or a column listed twice in such a key, a nullable column of the primary key, and two keys of the same columns.
 */
function defineKeys(
  name: string,
  columns: ColumnShape,
  options: TableOptions | undefined,
): AnyTableKeys {
  let primaryKey: KeyColumns | undefined
  const unique: KeyColumns[] = []
  for (const key of Object.keys(columns)) {
    const keyKind = columns[key]!.attributes.keyKind
    if (keyKind === "primaryKey") {
      if (primaryKey !== undefined) {
        throw new Error(
          `Table "${name}" marks columns "${primaryKey[0]}" and "${key}" with primaryKey(); list the columns of a primary key of several columns in the options`,
        )
      }
      primaryKey = Object.freeze([key] as const)
    } else if (keyKind === "unique") {
      unique.push(Object.freeze([key] as const))
    }
  }
  if (options?.primaryKey !== undefined) {
    if (primaryKey !== undefined) {
      throw new Error(
        `Table "${name}" declares its primary key both on column "${primaryKey[0]}" and in the options`,
      )
    }
    primaryKey = toKeyColumns(name, columns, options.primaryKey)
  }
  if (options?.unique !== undefined) {
    if (!Array.isArray(options.unique)) {
      throw new TypeError(`Unique keys in the options of table "${name}" must be an array`)
    }
    for (const key of options.unique) {
      unique.push(toKeyColumns(name, columns, key))
    }
  }
  for (const key of primaryKey ?? []) {
    if (columns[key]!.type.isNullable) {
      throw new Error(`Primary key column "${key}" of table "${name}" must not be nullable`)
    }
  }
  const keys = primaryKey === undefined ? unique : [primaryKey, ...unique]
  for (let index = 1; index < keys.length; index++) {
    for (let other = 0; other < index; other++) {
      if (hasSameColumns(keys[index]!, keys[other]!)) {
        throw new Error(
          `Table "${name}" declares the key of columns ${keys[index]!.map(key => `"${key}"`).join(", ")} twice`,
        )
      }
    }
  }
  return Object.freeze({ primaryKey, unique: Object.freeze(unique) })
}

/** Returns the column keys of a key of several columns from the options of table `name`, frozen, rejecting what `defineKeys` rejects in such a key. */
function toKeyColumns(name: string, columns: ColumnShape, key: unknown): KeyColumns {
  if (!Array.isArray(key) || key.length < 2) {
    throw new Error(
      `A key in the options of table "${name}" must list at least two columns; mark a key of one column with primaryKey() or unique()`,
    )
  }
  for (let index = 0; index < key.length; index++) {
    const column: unknown = key[index]
    if (typeof column !== "string" || !Object.hasOwn(columns, column)) {
      throw new Error(`A key in the options of table "${name}" lists unknown column "${column}"`)
    }
    if (key.indexOf(column) !== index) {
      throw new Error(`A key in the options of table "${name}" lists column "${column}" twice`)
    }
  }
  return Object.freeze(key.slice()) as unknown as KeyColumns
}

/** Tells whether keys `key` and `other` have the same columns, in any order; neither lists a column twice. */
function hasSameColumns(key: KeyColumns, other: KeyColumns): boolean {
  return key.length === other.length && key.every(column => other.includes(column))
}

/** Finds the column of `table` under `key`, ignoring properties inherited from the object prototype, such as `toString`. */
export function findColumn(table: AnyTable, key: string): AnyColumn | undefined {
  return Object.hasOwn(table.columns, key) ? table.columns[key] : undefined
}

/** Tells whether the columns of `table` under `columns` are exactly a key of it, primary or unique, in any order, as `IsKey` does in types. */
export function isKey(table: AnyTable, columns: readonly string[]): boolean {
  const listed = new Set(columns)
  return someKey(table, key => key.length === listed.size && isKeyAmong(key, listed))
}

/** Tells whether the columns of `table` under `columns` include a key of it, primary or unique, as `ContainsKey` does in types. */
export function containsKey(table: AnyTable, columns: readonly string[]): boolean {
  const listed = new Set(columns)
  return someKey(table, key => isKeyAmong(key, listed))
}

/** Tells whether `predicate` holds for a key of `table`, primary or unique. */
function someKey(table: AnyTable, predicate: (key: KeyColumns) => boolean): boolean {
  const { primaryKey, unique } = table.keys
  return (primaryKey !== undefined && predicate(primaryKey)) || unique.some(predicate)
}

/** Tells whether every column of `key` is in `columns`. */
function isKeyAmong(key: KeyColumns, columns: ReadonlySet<string>): boolean {
  return key.every(column => columns.has(column))
}

/** Returns the column of `table` under `key` as `findColumn` finds it, rejecting a key that is not a column. */
export function requireColumn(table: AnyTable, key: string): AnyColumn {
  const column = findColumn(table, key)
  if (!column) {
    throw new Error(`Unknown column "${key}" of table "${table.name}"`)
  }
  return column
}

/** Creates a column from a column definition, or returns `undefined` for a value that is neither a type nor a column. */
function toColumn(definition: unknown): AnyColumn | undefined {
  if (definition instanceof Column) {
    return definition
  }
  return isType(definition)
    ? new Column(definition, { name: undefined, keyKind: undefined })
    : undefined
}
