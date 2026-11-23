// Columns of a record in SQL text: the list of the result columns of a record that a statement selects, such as of a row of a table, and how a selection of a query of SQL text reads the record from them.

import { cutIdentifier, maxIdentifierBytes, quoteIdentifier } from "../identifier"
import { isRecordKey } from "../result"
import type { IsIndexKey, PickSelectedColumns } from "../selected-columns"
import type { AnyType, TypeOutput, typeValues } from "../type/type"
import { isType } from "../type/type"

import { freezesItself, SqlFragment } from "./fragment"

/** Column of a record that `createSqlColumns` takes, of key `Key` and type `T`. */
export interface SqlColumn<Key extends string = string, T extends AnyType = AnyType> {
  /** Key of the value of the column in the record, typed as a string literal, a union of them, `string`, or a template: the record does not tell the columns of a key of another type, such as a branded `string` or a member of a string enum. */
  readonly key: Key
  /** Name of the column in SQL, such as in its table. */
  readonly name: string
  /** Type that decodes the values of the column, which the fragment selects by the read expression of the type, if it has one. */
  readonly type: T
}

/** Options of `createSqlColumns` of columns of keys `Key`. */
export interface SqlColumnsOptions<Key extends string = string> {
  /** Name that qualifies the columns in SQL, such as the alias of their table in the statement; without it, the columns are not qualified. */
  readonly alias?: string | undefined
  /**
   * Prefix of the names of the result columns, such as `job` for `job__id`; the result columns of several records of one statement must have different names.
   *
   * It is the alias by default, which already differs for each source of a statement; without both, a result column has the key of its column as its name.
   */
  readonly prefix?: string | undefined
  /** Keys of the columns that are never `NULL` in a row of the record, such as those of a primary key, by which `nullable` tells a missing row unless it takes other columns. */
  readonly key?: readonly Key[] | undefined
}

/**
 * Record of columns `C`, with the values that their types return under their keys.
 *
 * A key that the list does not guarantee, such as of a column that is a union of columns, of a column of a spread array, or of a key typed as `string`, is optional, as in `select` of kern-orm by keys; a column of one known key written before or after a spread is guaranteed.
 * A key has the values of every column of the list that names it, and a key of an index signature those of every column.
 */
// Distributive, so that each list of a union of lists has the values of its own columns.
export type SqlColumnsRecord<C extends readonly SqlColumn[]> = C extends unknown
  ? ColumnKeys<C> extends infer Keys extends readonly (keyof ColumnsRow<C>)[]
    ? FlattenRecord<PickSelectedColumns<ColumnsRow<C>, Keys>>
    : never
  : never

/** Record `R`, such as an intersection of records, as one record of its properties, so that editors show them; distributive over a union of records. */
type FlattenRecord<R> = R extends unknown ? { [K in keyof R]: R[K] } : never

/** Record of all the keys of columns `C`, each with the values of the columns that name it: a key is told by the columns, not by their positions in the list. */
type ColumnsRow<C extends readonly SqlColumn[]> = {
  // A key of an index signature has the values of every column, so that types need not compare the names that it may have with the keys of the other columns, also of a known key, which the index signature absorbs.
  [E in ColumnOfEachKey<C[number]> as E["key"]]: IsIndexKey<E["key"]> extends true
    ? TypeOutput<C[number]["type"]>
    : TypeOutput<E["type"]>
}

/** Column `E`, a union of columns, as a column of each of its keys, so that a key that is one of several, such as `` "id" | `key${number}` ``, is told apart from the others. */
type ColumnOfEachKey<E extends SqlColumn> = E extends unknown
  ? ColumnOfKey<E["key"], E["type"]>
  : never

/** Column of type `T` of each key of `Key`, a union of keys. */
type ColumnOfKey<Key extends string, T extends AnyType> = Key extends unknown
  ? { key: Key; type: T }
  : never

/** List of the keys of columns `C`, in their order. */
type ColumnKeys<C extends readonly SqlColumn[]> = { readonly [I in keyof C]: C[I]["key"] }

/** Tells whether options `O` of `createSqlColumns` give the columns their key; `boolean` when the type of the options does not tell it, such as of options that may be missing or whose key is optional. */
// Distributive, so that options that may be missing, or one of several options, give the union of their answers.
export type HasColumnsKey<O> = O extends { readonly key: readonly [string, ...string[]] }
  ? true
  : O extends undefined
    ? false
    : "key" extends keyof O
      ? [O["key"]] extends [undefined]
        ? false
        : boolean
      : false

/** Field of the record of `SqlColumns`: the key of its value, the name of the result column that it reads, and the type that decodes the value. */
export interface SqlColumnsField {
  readonly key: string
  readonly column: string
  readonly type: AnyType
}

// The types tell a column that can be `NULL` by `null` among its values, so they keep a key whose values are `unknown` or `any`, such as of a JSON column, which `nullable` checks by the type of the column.
/** Keys of record `R` that can tell a missing row of the record: those of a property that the record has, whose values are known to be never `null`, or are not known. */
export type PresenceKey<R> = PresenceKeyOf<R, keyof R>

/** Keys `Keys` of record `R`, a union of records, that can tell a missing row, as `PresenceKey` tells. */
type PresenceKeyOf<R, Keys extends PropertyKey> = {
  // Not distributive over `R`, so that every record of a union has the property; a record of an optional property may not have it, and an index signature satisfies a record of its key, which `nullable` checks at runtime.
  [K in Keys]: [R] extends [Record<K, unknown>] ? PresenceValueKey<R, K & keyof R> : never
}[Keys]

/** Key `K` of record `R` when its values can tell a missing row: they are known to be never `null`, or are not known. */
type PresenceValueKey<R, K extends keyof R> = unknown extends R[K]
  ? K
  : null extends R[K]
    ? never
    : K

/** Options of `nullable` of the columns of record `R`. */
export interface NullableColumnsOptions<R> {
  /** Keys of the columns by which to tell a missing row, which must never be `NULL` in a row of the record: the record is `null` when all of them are `NULL`. */
  readonly by: readonly [PresenceKey<NonNullable<R>>, ...PresenceKey<NonNullable<R>>[]]
}

/**
 * Arguments of `nullable` of the columns of record `R`: the options are required when `HasKey` is `false`.
 *
 * When `HasKey` is `boolean`, such as of a key of an array type, the options are optional, and `nullable` without them rejects at runtime when the columns have no key.
 */
export type NullableColumnsArguments<R, HasKey extends boolean> = HasKey extends true
  ? [options?: NullableColumnsOptions<R>]
  : [options: NullableColumnsOptions<R>]

/**
 * Columns of a record in SQL text, such as of a row of a table: a SQL fragment of the list of its result columns, which a template interpolates, such as after `SELECT` or `RETURNING`, and which `select` of a query of SQL text takes as a field, to read the record of type `R` from these columns.
 *
 * It is immutable, and its fragment has no parameters.
 * `HasKey` tells whether the columns include the key of the record, by which `nullable` tells a missing row.
 */
// `nullable` reads the record and the key from `this`, so that the columns stay covariant in both.
export class SqlColumns<out R, out HasKey extends boolean = boolean> extends SqlFragment {
  static readonly [freezesItself] = true

  /** Record that a selection reads from the columns, for type inference, as the values of a type; absent at runtime. */
  declare readonly [typeValues]: { output: R; input: never }
  /** Whether the columns include their key, for types only; absent at runtime. */
  declare readonly hasKey: HasKey

  constructor(
    text: string,
    /** Fields of the record, in the order of the result columns of the fragment. */
    readonly fields: readonly SqlColumnsField[],
    /** Positions among `fields` of those whose result columns tell a missing row of the record, which a selection reads as `null`, when they are all `NULL`; `undefined` when the record is never `null`. */
    readonly presence: readonly number[] | undefined,
    /** Positions among `fields` of the key of the record, which `nullable` reads by default; `undefined` when the columns do not include it. */
    private readonly key: readonly number[] | undefined,
  ) {
    // Frozen as the fields are, so that the SQL of the columns cannot differ from what a selection reads.
    super(Object.freeze([text]), Object.freeze([]))
    Object.freeze(this)
  }

  /**
   * SQL text of the list of the result columns, such as `"j"."id" AS "j__id", "j"."run_at" AS "j__runAt"`, for a statement built as text.
   *
   * Interpolate the columns themselves into a template, such as of `sql`: it would pass the text as a parameter.
   */
  get text(): string {
    return this.strings[0]!
  }

  /**
   * Returns the columns of a record that is `null` without its row, such as of a table joined with `LEFT JOIN`, which a selection tells by the columns of the key of the record, such as its primary key, being all `NULL`.
   *
   * Columns without their key take the columns that tell a missing row in `by`, which replaces the key also of columns that include it.
   * A row with only some of these columns `NULL` rejects with `ResultDecodeError`.
   */
  nullable<R, HasKey extends boolean>(
    this: SqlColumns<R, HasKey>,
    ...parameters: NullableColumnsArguments<R, HasKey>
  ): SqlColumns<NonNullable<R> | null, HasKey>
  nullable(options?: { readonly by?: unknown }): AnySqlColumns {
    const by = options?.by
    let presence = this.key
    if (by !== undefined) {
      if (!Array.isArray(by) || by.length === 0) {
        throw new TypeError("nullable() takes a non-empty array of the keys of columns in `by`")
      }
      const positions: number[] = []
      for (const key of by as unknown[]) {
        const position = this.fields.findIndex(field => field.key === key)
        if (position === -1) {
          throw new Error(`nullable() takes in \`by\` a column of the record, not "${String(key)}"`)
        }
        if (positions.includes(position)) {
          throw new Error(`nullable() takes column "${String(key)}" in \`by\` twice`)
        }
        requirePresenceColumn(this.fields[position]!)
        positions.push(position)
      }
      presence = Object.freeze(positions)
    }
    if (presence === undefined) {
      throw new Error(
        "nullable() tells a missing row by the key of the record, which these columns do not include; pass the columns that are never NULL in a row in `by`",
      )
    }
    return new SqlColumns(this.text, this.fields, presence, this.key)
  }
}

/** Columns of any record. */
// oxlint-disable-next-line typescript/no-explicit-any -- any columns regardless of their record
export type AnySqlColumns = SqlColumns<any, any>

/**
 * Creates the columns of a record from `columns` of a source of a statement, such as of a table: the fragment selects each of them under the name of a result column, which a selection reads its value from.
 * It applies the read expression of the type of each column that has one.
 *
 * It rejects a column twice, a key that a record cannot have, and a name of a result column that PostgreSQL may truncate in a server encoding or that is not well-formed.
 */
export function createSqlColumns<const C extends readonly SqlColumn[]>(
  columns: C,
): SqlColumns<SqlColumnsRecord<C>, false>
// The options are a parameter of their own signature rather than an optional one, whose type would lose `undefined` of options that may be missing.
export function createSqlColumns<
  const C extends readonly SqlColumn[],
  const O extends SqlColumnsOptions<C[number]["key"]> | undefined,
>(columns: C, options: O): SqlColumns<SqlColumnsRecord<C>, HasColumnsKey<O>>
export function createSqlColumns(
  columns: readonly SqlColumn[],
  options: SqlColumnsOptions = {},
): AnySqlColumns {
  const { alias } = options
  if (alias !== undefined && (typeof alias !== "string" || alias === "")) {
    throw new TypeError("The alias of columns must be a non-empty string")
  }
  if (
    options.prefix !== undefined &&
    (typeof options.prefix !== "string" || options.prefix === "")
  ) {
    throw new TypeError("The prefix of columns must be a non-empty string")
  }
  const prefix = options.prefix ?? alias
  if (columns.length === 0) {
    throw new Error("Columns of a record must include at least one column")
  }
  const qualifier = alias === undefined ? "" : `${quoteIdentifier(alias)}.`
  const fields: SqlColumnsField[] = []
  let text = ""
  for (const { key, name, type } of columns) {
    if (typeof key !== "string" || key === "" || !isRecordKey(key)) {
      throw new Error(`Column "${String(key)}" cannot be a key of a record`)
    }
    if (typeof name !== "string" || name === "") {
      throw new TypeError(`Column "${key}" must have a name as a non-empty string`)
    }
    if (!isType(type)) {
      throw new TypeError(`Column "${key}" must have a type`)
    }
    if (fields.some(field => field.key === key)) {
      throw new Error(`Columns of a record include column "${key}" twice`)
    }
    const column = prefix === undefined ? key : `${prefix}__${key}`
    // A statement finds no column of a name that the server or the driver changes only after it runs.
    if (!column.isWellFormed()) {
      throw new Error(
        `The result name for column "${key}" contains a lone surrogate, which a driver replaces when it encodes the statement`,
      )
    }
    if (cutIdentifier(column, maxIdentifierBytes).length !== column.length) {
      throw new Error(
        `Result column "${column}" has a name that may be longer than ${maxIdentifierBytes} bytes in a server encoding, where a character other than ASCII takes up to 4, and PostgreSQL truncates a longer name; ${prefix === undefined ? "give the column a shorter key" : "set a shorter prefix or give the column a shorter key"}`,
      )
    }
    const value = `${qualifier}${quoteIdentifier(name)}`
    // The type decodes the result of its read expression, so the fragment selects the column by it.
    const { read } = type
    text += `${text === "" ? "" : ", "}${read === undefined ? value : read(value)} AS ${quoteIdentifier(column)}`
    fields.push(Object.freeze({ key, column, type }))
  }
  let key: number[] | undefined
  if (options.key !== undefined) {
    key = []
    for (const keyColumn of options.key) {
      const position = fields.findIndex(field => field.key === keyColumn)
      if (position === -1) {
        throw new Error(`Columns of a record do not include column "${keyColumn}" of their key`)
      }
      requirePresenceColumn(fields[position]!)
      key.push(position)
    }
    if (key.length === 0) {
      throw new Error("The key of columns must have at least one column")
    }
    Object.freeze(key)
  }
  return new SqlColumns(text, Object.freeze(fields), undefined, key)
}

/** Rejects `field` as a column that tells a missing row of its record, when its type is nullable: its `NULL` would read as a missing row. */
function requirePresenceColumn(field: SqlColumnsField): void {
  if (field.type.isNullable) {
    throw new Error(
      `Column "${field.key}" is nullable, so its NULL does not tell a missing row of the record`,
    )
  }
}
