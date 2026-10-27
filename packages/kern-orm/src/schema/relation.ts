import type { HasEquality } from "../expression/operators/equality"
import { isEqualityCompatible } from "../expression/operators/equality"
import type { EmptyRecord } from "../query/select"
import type {
  AnyTable,
  ColumnOperators,
  ContainsKey,
  IsExactKey,
  IsKey,
  KeyOf,
  Selectable,
} from "../table/table"
import { containsKey, findColumn, isKey } from "../table/table"
import type { IsUnion } from "../utils/type-helpers"

import type { Tables } from "./schema"

declare const sourceTable: unique symbol
declare const sourceKey: unique symbol
declare const toKey: unique symbol

/** Runtime mark of the declarations of `many` and `one`. */
const declarationBrand = Symbol("kern-orm.relation")

/** Kind of a relation: `many` related records, or `one` related record at most. */
export type RelationKind = "many" | "one"

/** Relation of a table of a schema to the records of table `Target`, which has key `TargetKey` in the schema. */
export interface Relation<
  Kind extends RelationKind = RelationKind,
  Target extends AnyTable = AnyTable,
  TargetKey extends string = string,
  Required extends boolean = boolean,
> {
  readonly kind: Kind
  readonly target: Target
  readonly targetKey: TargetKey
  /** Whether every record of the table has its related record, so that a query of a relation `one` rejects without it rather than giving `null`; `false` for a relation `many`. */
  readonly required: Required
}

// Composition includes every table of a part under its key and a table under one key, so the keys of a definition are the same in every schema that has it.
/**
 * Relation of a table of a schema as `$relations` defines it: the columns of its keys, compared by SQL `=` in order.
 *
 * Composition includes a definition as it is, so a relation that several parts include is one definition.
 */
export interface RelationDefinition extends Relation {
  readonly name: string
  /** Key of the source table. */
  readonly key: string
  readonly source: AnyTable
  readonly from: readonly string[]
  readonly to: readonly string[]
}

/** Relation `N` of the table under key `K` of a schema, of type `R`, whose records a query selects. */
export interface UsedRelation<
  K extends string = string,
  N extends string = string,
  R extends Relation = Relation,
> {
  readonly key: K
  readonly name: N
  readonly relation: R
}

/** Relations of schema relations `R` that the queries of a `Db` of the schema may select. */
export type UsableRelation<R extends SchemaRelations> = {
  [K in keyof R & string]: {
    [N in keyof R[K] & string]: UsedRelation<K, N, R[K][N]>
  }[keyof R[K] & string]
}[keyof R & string]

/** Relations of the tables of a schema by table key and relation name. */
export type SchemaRelations = { readonly [key: string]: TableRelations }

/** Relations of a table of a schema by relation name. */
export type TableRelations = { readonly [name: string]: Relation }

/**
 * Declaration of a relation by `many` or `one`, which `$relations` of a schema defines for a table of type `Source` with key `From` of the source table and key `To` of the target table.
 *
 * `Source` and `From` only type the keys of the source table, and `To` only types the inferred `required`.
 */
export interface RelationDeclaration<
  Kind extends RelationKind,
  Source extends AnyTable,
  Target extends AnyTable,
  From = unknown,
  To = unknown,
  Required extends boolean | undefined = boolean | undefined,
> {
  readonly [declarationBrand]: true
  readonly kind: Kind
  readonly target: Target
  readonly from: readonly string[]
  readonly to: readonly string[]
  /** Whether the relation is required as declared; `undefined` leaves it to `$relations` to infer from the keys. */
  readonly required: Required
  // Contravariant, so that a declaration of an unknown source, made outside `$relations`, fits any table.
  readonly [sourceTable]?: (source: Source) => void
  // `$relations` checks it against its table, also where contextual typing gives no source, such as for a relation named `constructor` or declared outside `$relations`.
  readonly [sourceKey]?: From
  readonly [toKey]?: To
}

/** Column key of table `T` whose type has SQL `=`, which a relation can compare. */
type EqualityKey<T extends AnyTable> = {
  [K in keyof T["columns"]]: HasEquality<ColumnOperators<T, K>> extends true ? K : never
}[keyof T["columns"]] &
  string

/** Key of a relation in table `T`: a column key, or a non-empty list of them for a composite key. */
export type RelationKey<T extends AnyTable> =
  | EqualityKey<T>
  | readonly [EqualityKey<T>, ...EqualityKey<T>[]]

/** Key of table `T` with as many columns as key `From`. */
type MatchingKey<T extends AnyTable, From> = From extends string
  ? EqualityKey<T>
  : { readonly [I in keyof From]: EqualityKey<T> }

/** Keys of a relation: the columns `from` of the source table equal the columns `to` of the target table, in order. */
export interface RelationKeys<Target extends AnyTable, From> {
  readonly from: From
  readonly to: MatchingKey<Target, From>
}

/** Keys of a relation `one`, as in `RelationKeys`, and whether the relation is required. */
export interface OneRelationKeys<From, To> {
  readonly from: From
  readonly to: To
  /** Whether every record has its related record; `$relations` infers it from the keys when it is not set. */
  readonly required?: boolean
}

// A property `required` of its own type parameter would lose its optionality, such as of `required?: true`, which may be missing at runtime.
/** Members of the keys `K` of a relation `one` with only `required` typed, so that a call infers `K` with `required` as optional as it is, and reports a wrong key at its own member. */
export type RequiredMember<K> = { readonly [P in keyof K]: P extends "required" ? K[P] : unknown }

/** Value of `required` that the keys `K` of a relation `one` declare, with `undefined` where they may omit it. */
type DeclaredRequiredOf<K> = K extends unknown
  ? "required" extends keyof K
    ? K extends { readonly required: infer Required }
      ? Required
      : K["required" & keyof K] | undefined
    : undefined
  : never

/** Declarations of `$relations` of a schema of tables `T`: relations by name, for tables by their keys. */
export type RelationDeclarations<T extends Tables> = {
  readonly [K in keyof T]?: {
    readonly [name: string]: RelationDeclaration<RelationKind, T[K], T[keyof T]>
  }
}

/**
 * Declarations `D` of `$relations` checked by the names they use: relations of the tables of `T` under their keys, and no other keys.
 *
 * Declarations under the names of `D` get their source table from this type even where the index signature of `RelationDeclarations` gives way to a member of `Object`, such as for a relation named `toString`.
 * A relation name must not be a column key of its table or start with `$`, since the references that the callback of `select` gets have both.
 */
export type CheckDeclarations<T extends Tables, D> = {
  readonly [K in keyof D]: [TableKey<T, K>] extends [never]
    ? never
    : undefined extends D[K]
      ? D[K]
      : {
          readonly [N in keyof D[K]]: `${N & (string | number)}` extends ReservedName<
            T[TableKey<T, K>]
          >
            ? never
            : RelationDeclaration<
                RelationKind,
                T[TableKey<T, K>],
                T[keyof T],
                RelationKey<T[TableKey<T, K>]>
              >
        }
}

/** Names that a relation of table `T` cannot have: the keys of its columns, and names starting with `$`. */
type ReservedName<T extends AnyTable> = `${keyof T["columns"] & (string | number)}` | `$${string}`

/** Key of tables `T` written as key `K`, such as `1` for `"1"`, as object keys are strings at runtime. */
type TableKey<T extends Tables, K> = {
  [P in keyof T]: `${P & (string | number)}` extends `${K & (string | number)}` ? P : never
}[keyof T]

/** Relations that declarations `D` of a schema of tables `T` define, by table key and relation name, as strings like the keys of objects. */
export type DeclaredRelations<T extends Tables, D> = {
  [K in keyof D as K extends number ? `${K}` : K]: {
    // The source is contravariant, so `never` matches a declaration of any source.
    [N in keyof D[K] as N extends number ? `${N}` : N]: D[K][N] extends RelationDeclaration<
      infer Kind,
      never,
      infer Target,
      infer From,
      infer To,
      infer Required
    >
      ? Relation<
          Kind,
          Target,
          KeyOfTable<T, Target>,
          DeclaredRequired<T[TableKey<T, K>], Target, From, To, Required>
        >
      : never
  }
}

/**
 * Whether a relation from table `Source` to table `Target` with keys `From` and `To` is required: `Required` as declared, or inferred from the keys when it is `undefined`.
 *
 * The inferred relation is required when no column `from` is nullable, the columns `from` include no key of the source, and the columns `to` are a key of the target, primary or unique.
 * It is `boolean` where the types do not tell, such as for a key `to` typed as a union or a table whose type does not tell its keys; then the result of a query of the relation includes `null`, as when the relation is not required.
 */
type DeclaredRequired<
  Source extends AnyTable,
  Target extends AnyTable,
  From,
  To,
  Required,
> = Required extends boolean
  ? Required
  : null extends Selectable<Source>[RelationColumn<From> & keyof Source["columns"]]
    ? false
    : IsUncertainKey<To> extends true
      ? boolean
      : KeyedRequired<ContainsKey<Source, RelationColumn<From>>, IsKey<Target, RelationColumn<To>>>

// Columns `from` that include a key of the source match each record of the target from at most one record, as on the side of a one-to-one relation without the foreign key, so the record may be missing.
/** Whether the keys of a relation make it required: `false` when its columns `from` include a key of the source, as `FromKeyed` tells, and otherwise `ToKey`, whether its columns `to` are a key of the target; `FromKeyed` of `boolean` gives the union. */
type KeyedRequired<FromKeyed extends boolean, ToKey extends boolean> = FromKeyed extends true
  ? false
  : ToKey

/** Column key of relation key `K`: the key itself, or a column of a composite key. */
type RelationColumn<K> = K extends readonly unknown[] ? K[number] : K

/** Tells whether relation key `K` does not tell its columns: it is a union, or has one in a position of its tuple. */
type IsUncertainKey<K> =
  true extends IsUnion<K>
    ? true
    : K extends readonly unknown[]
      ? IsExactKey<K> extends true
        ? false
        : true
      : false

/** Check of key `To` of a relation `one` that rejects it when its columns include no key of table `Target`, as far as the types tell. */
type TargetKeyCheck<Target extends AnyTable, To> = [
  ContainsKey<Target, RelationColumn<To>>,
] extends [false]
  ? { readonly to: MissingKey<KeyOf<Target["keys"]>> }
  : unknown

/** Type that a key `to` of a relation `one` without a key of its target is checked against, naming the keys of the target. */
interface MissingKey<Keys> {
  readonly "columns to must include a key of the target": Keys
}

/** Key of table `Target` among tables `T`, as a string like the keys of objects. */
type KeyOfTable<T extends Tables, Target> = {
  [K in keyof T]: [T[K]] extends [Target]
    ? [Target] extends [T[K]]
      ? K extends number
        ? `${K}`
        : K & string
      : never
    : never
}[keyof T]

/** Relations of `R` by table key, with the relations under the same key merged. */
export type MergeRelations<R> = { [K in keyof R]: { [N in keyof R[K]]: R[K][N] } }

/** Relations of the schema that a query starts from, by table key, and the key of the table of the query there. */
export interface SchemaContext<
  R extends SchemaRelations = SchemaRelations,
  K extends string = string,
> {
  readonly relations: R
  readonly key: K
}

/** Schema context of a query whose table has no relations, such as one of `from(table)`. */
export type NoRelations = SchemaContext<EmptyRecord, string>

// Only a numeric key is turned into its string, which costs more to instantiate for every table.
/** Schema context of the queries of the table under key `K` of a schema of relations `R`, whose keys are strings, as object keys are at runtime. */
export type TableContext<R extends SchemaRelations, K> = K extends keyof R
  ? [keyof R[K]] extends [never]
    ? NoRelations
    : SchemaContext<R, K & string>
  : K extends number
    ? TableContext<R, `${K}`>
    : NoRelations

/**
 * Declares a relation of a table to the records of `target` whose columns `to` equal its columns `from`, for `$relations` of a schema.
 *
 * A composite key lists its columns in arrays of the same length.
 */
export function many<
  Source extends AnyTable,
  Target extends AnyTable,
  const From extends RelationKey<Source>,
>(
  target: Target,
  keys: RelationKeys<Target, From>,
): RelationDeclaration<"many", Source, Target, From, unknown, false> {
  return declareRelation("many", target, keys, false)
}

/**
 * Declares a relation of a table to the record of `target` whose columns `to` equal its columns `from`, for `$relations` of a schema.
 *
 * A composite key lists its columns in arrays of the same length.
 * The columns `to` must include a key of `target`, primary or unique, so that they match at most one record.
 * Without the record, a query of a required relation rejects, and a query of a relation that is not required gives `null`.
 * Unless `required` is set, the relation is required when no column `from` is nullable, the columns `from` include no key of their table, and the columns `to` are a key of `target`.
 */
export function one<
  Source extends AnyTable,
  Target extends AnyTable,
  const From extends RelationKey<Source>,
  const To extends MatchingKey<Target, From>,
  const Keys extends object = EmptyRecord,
>(
  target: Target,
  keys: OneRelationKeys<From, To> & RequiredMember<Keys> & TargetKeyCheck<Target, To>,
  // Without `NoInfer`, the declarations of `$relations` would infer `Keys` from their own type, whose `required` is `boolean | undefined`.
): RelationDeclaration<"one", Source, Target, From, To, NoInfer<DeclaredRequiredOf<Keys>>> {
  return declareRelation("one", target, keys, keys.required as DeclaredRequiredOf<Keys>)
}

function declareRelation<
  Kind extends RelationKind,
  Source extends AnyTable,
  Target extends AnyTable,
  From,
  To,
  Required extends boolean | undefined,
>(
  kind: Kind,
  target: Target,
  keys: { readonly from: unknown; readonly to: unknown },
  required: Required,
): RelationDeclaration<Kind, Source, Target, From, To, Required> {
  return Object.freeze({
    [declarationBrand]: true as const,
    kind,
    target,
    from: toKeyList(keys.from),
    to: toKeyList(keys.to),
    required,
  })
}

function toKeyList(key: unknown): readonly string[] {
  return Object.freeze(Array.isArray(key) ? key.slice() : [key])
}

/**
 * Defines relation `name` of table `source`, declared under its key `key` in a schema, checking its target and its keys.
 *
 * `findKey` returns the key of a table in the schema, or `undefined` for a table outside it.
 * Each pair of columns of the keys must satisfy `isEqualityCompatible`, and the columns `to` of a relation `one` must include a key of the target.
 * A relation without a declared `required` is required when no column `from` is nullable by the `isNullable` of its type, the columns `from` include no key of the source, and the columns `to` are a key of the target.
 */
export function defineRelation(
  source: AnyTable,
  key: string,
  name: string,
  declaration: unknown,
  findKey: (table: AnyTable) => string | undefined,
): RelationDefinition {
  const subject = `Relation "${key}.${name}"`
  if (!isRelationDeclaration(declaration)) {
    throw new TypeError(`${subject} must be declared with many or one`)
  }
  // The references that the callback of `select` gets have the columns and the relations of their table under their names.
  if (name.startsWith("$")) {
    throw new Error(`${subject}: a relation name must not start with "$"`)
  }
  if (findColumn(source, name)) {
    throw new Error(
      `${subject}: a relation name must differ from the column keys of table "${source.name}"`,
    )
  }
  const { kind, target, from, to, required } = declaration
  const targetKey = findKey(target)
  if (targetKey === undefined) {
    throw new Error(`${subject} refers to table "${target.name}", which is not part of the schema`)
  }
  if (from.length === 0 || from.length !== to.length) {
    throw new Error(`${subject} must list as many columns in "to" as in "from", at least one`)
  }
  let nullable = false
  for (let index = 0; index < from.length; index++) {
    const fromColumn = findColumn(source, from[index]!)
    if (!fromColumn) {
      throw new Error(`${subject}: unknown column "${from[index]}" of table "${source.name}"`)
    }
    nullable ||= fromColumn.type.isNullable
    const toColumn = findColumn(target, to[index]!)
    if (!toColumn) {
      throw new Error(`${subject}: unknown column "${to[index]}" of table "${target.name}"`)
    }
    if (!isEqualityCompatible(fromColumn.type, toColumn.type)) {
      throw new Error(
        `${subject} cannot compare column "${from[index]}" (${fromColumn.type.sqlType}) with column "${to[index]}" (${toColumn.type.sqlType}) of table "${target.name}" by SQL =`,
      )
    }
  }
  if (kind === "one" && !containsKey(target, to)) {
    throw new Error(
      `${subject}: columns "to" must include a key of table "${target.name}", primary or unique`,
    )
  }
  return Object.freeze({
    kind,
    name,
    key,
    source,
    target,
    targetKey,
    from,
    to,
    required: required ?? (!nullable && !containsKey(source, from) && isKey(target, to)),
  })
}

/** Relation definitions of a schema being composed, by table key and relation name. */
export type RelationMap = Map<string, Map<string, RelationDefinition>>

/** Adds `definition` of relation `name` of the table under `key` to `relations`, rejecting another definition of the relation there. */
export function addRelation(
  relations: RelationMap,
  key: string,
  name: string,
  definition: RelationDefinition,
): void {
  let named = relations.get(key)
  if (named === undefined) {
    named = new Map()
    relations.set(key, named)
  }
  const existing = named.get(name)
  if (existing !== undefined && existing !== definition) {
    throw new Error(`Relation "${key}.${name}" has two different definitions`)
  }
  named.set(name, definition)
}

/** Adds the relation definitions of a schema to `relations`, rejecting another definition of a relation there. */
export function addRelations(relations: RelationMap, added: SchemaRelations): void {
  for (const key of Object.keys(added)) {
    const named = added[key]!
    for (const name of Object.keys(named)) {
      addRelation(relations, key, name, named[name] as RelationDefinition)
    }
  }
}

/** Collects the relation definitions of a schema, which a `Db` of the schema accepts in its queries. */
export function collectDefinitions(relations: SchemaRelations): Set<RelationDefinition> {
  const definitions = new Set<RelationDefinition>()
  for (const key of Object.keys(relations)) {
    const named = relations[key]!
    for (const name of Object.keys(named)) {
      definitions.add(named[name] as RelationDefinition)
    }
  }
  return definitions
}

/** Creates frozen relations of a schema from `relations`; objects without a prototype keep any key, such as `__proto__`, an own property. */
export function freezeRelations(relations: RelationMap): SchemaRelations {
  const result: Record<string, TableRelations> = Object.create(null)
  for (const [key, named] of relations) {
    const table: Record<string, Relation> = Object.create(null)
    for (const [name, definition] of named) {
      table[name] = definition
    }
    result[key] = Object.freeze(table)
  }
  return Object.freeze(result)
}

function isRelationDeclaration(
  value: unknown,
): value is RelationDeclaration<RelationKind, AnyTable, AnyTable> {
  return typeof value === "object" && value !== null && declarationBrand in value
}
