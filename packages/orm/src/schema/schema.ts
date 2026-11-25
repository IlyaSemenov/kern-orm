import type { AnyDb } from "../execution/db"
import type { RecordQuery, SelectionState } from "../query/record"
import { startRecordQuery } from "../query/record"
import { createQueryContexts } from "../query/relations"
import type { SelectQuery } from "../query/select"
import { startQuery } from "../query/select"
import type { Selection } from "../query/selection"
import type { EmptyRecord, TableQueryState } from "../query/state"
import type { AnyRowSource } from "../table/table"
import { capitalize } from "../utils/capitalize"

import type {
  CheckDeclarations,
  DeclaredRelations,
  MergeRelations,
  RelationDeclarations,
  RelationMap,
  SchemaRelations,
  TableContext,
} from "./relation"
import { addRelation, addRelations, defineRelation, freezeRelations } from "./relation"
import type { AnySequence, Sequences } from "./sequence"
import { isSequence, SequenceReference } from "./sequence"

const schemaBrand = Symbol("kern-orm.schema")

/** Key of the relation definitions of a schema, which composition reads. */
export const schemaRelations = Symbol("kern-orm.schema.relations")

/** Tables by their keys; a key must not start with `$`, which is reserved for schema and `Db` members. */
export type Tables = Record<string, AnyRowSource>

/** Table, view, or sequence of a schema, which a statement names in the PostgreSQL schema of its `Db`. */
export type SchemaObject = AnyRowSource | AnySequence

/** Tables and sequences by their keys, as an object part of a schema definition takes them. */
export type SchemaObjects = Record<string, SchemaObject>

/**
 * Immutable collection of tables, sequences, and the relations of the tables with query entry points.
 *
 * A schema is not bound to a database, so queries built from it can be defined at module level.
 * A `Db` can execute such a query if its schema contains the tables, the sequences, and the selected relations of the query and every bound nested query and bound sequence of the query belongs to that `Db`.
 */
export type Schema<
  T extends Tables,
  S extends Sequences = EmptyRecord,
  R extends SchemaRelations = EmptyRecord,
> = SchemaEntries<T, R> & SequenceEntries<S> & SchemaMembers<T, S, R>

/** Query entry points; each access starts a query over a new table occurrence, of the one row of a singleton table. */
type SchemaEntries<T extends Tables, R extends SchemaRelations> = {
  readonly [K in keyof T]: SelectQuery<TableQueryState<T[K], TableContext<R, K>>>
}

/** Sequences of a schema or a `Db` by their keys. */
export type SequenceEntries<S extends Sequences> = {
  readonly [K in keyof S]: SequenceReference<S[K]>
}

/** Members of a schema that composition reads: its tables, its sequences, and the relations of its tables. */
interface SchemaContents<T extends Tables, S extends Sequences, R extends SchemaRelations> {
  readonly [schemaBrand]: true
  /** Tables of the schema by their keys. */
  readonly $tables: T
  /** Sequences of the schema by their keys. */
  readonly $sequences: S
  /** Relation definitions by table key and relation name. */
  readonly [schemaRelations]: R
}

interface SchemaMembers<
  T extends Tables,
  S extends Sequences,
  R extends SchemaRelations,
> extends SchemaContents<T, S, R> {
  // Typed by `this` rather than by `T`, `S`, and `R`, so that the method is the same in every schema, and comparing schemas, such as of a `Db` passed as a `DbOf`, does not compare its generic signatures.
  /**
   * Creates a schema of the same tables with the relations of `relations` added, declared with `many` and `one` by their names under the keys of their tables.
   *
   * A relation refers to a table of the schema by columns of SQL types that `=` compares; a relation that the schema already has is rejected.
   */
  $relations<Self extends AnySchema, D extends RelationDeclarations<Self["$tables"]>>(
    this: Self,
    relations: D & CheckDeclarations<Self["$tables"], D>,
  ): Schema<
    Self["$tables"],
    Self["$sequences"],
    MergeRelations<Self[typeof schemaRelations] & DeclaredRelations<Self["$tables"], D>>
  >
  /**
   * Starts an unbound query of one record whose fields are the values of the expressions and of the literals and the results of the queries of `selection`, selected in one statement.
   *
   * The value of the field of a query is the result it gives when executed, such as an array of records or one value.
   */
  $select<Sel extends Selection>(selection: Sel): RecordQuery<SelectionState<Sel>>
}

/** Schema of any tables, sequences, and relations. */
export type AnySchema = SchemaContents<Tables, Sequences, SchemaRelations>

/** Part of a schema definition: an object of tables and sequences by their keys, or a schema whose tables, relations, and sequences it includes. */
export type SchemaPart = SchemaObjects | AnySchema

/**
 * Tables of the parts of a schema definition by their keys.
 *
 * A part typed as a union gives a union of tables, and parts of an array of unknown length give no tables, since any of them may be missing.
 */
export type SchemaTables<P extends readonly SchemaPart[]> =
  ComposeParts<P>["tables"] extends infer T extends Tables ? { [K in keyof T]: T[K] } : never

/** Relations of the parts of a schema definition by table key and relation name, read as `SchemaTables` reads the tables. */
export type SchemaPartRelations<P extends readonly SchemaPart[]> =
  ComposeParts<P>["relations"] extends infer R extends SchemaRelations ? MergeRelations<R> : never

/** Sequences of the parts of a schema definition by their keys, read as `SchemaTables` reads the tables. */
export type SchemaSequences<P extends readonly SchemaPart[]> =
  ComposeParts<P>["sequences"] extends infer S extends Sequences ? { [K in keyof S]: S[K] } : never

/** Tables, relations, and sequences of the parts of a schema definition, intersected. */
interface PartContents {
  readonly tables: Tables
  readonly relations: SchemaRelations
  readonly sequences: Sequences
}

// Both recursive branches are tail calls, so that TypeScript composes up to 1000 parts instead of about 50.
type ComposeParts<
  P extends readonly SchemaPart[],
  Composed extends PartContents = {
    tables: EmptyRecord
    relations: EmptyRecord
    sequences: EmptyRecord
  },
> = P extends readonly [infer First extends SchemaPart, ...infer Rest extends readonly SchemaPart[]]
  ? ComposeParts<Rest, Composed & ReadPart<First>>
  : P extends readonly [...infer Rest extends readonly SchemaPart[], infer Last extends SchemaPart]
    ? ComposeParts<Rest, Composed & ReadPart<Last>>
    : Composed

type ReadPart<P extends SchemaPart> =
  // oxlint-disable-next-line typescript/no-explicit-any -- the relations and the sequences of any schema
  P extends SchemaContents<infer T, any, any>
    ? { tables: T; relations: P[typeof schemaRelations]; sequences: P["$sequences"] }
    : ReadObjects<P>

// A part without sequences is read as its tables as they are, since splitting its keys makes TypeScript instantiate the queries of a `Db` of the schema again, such as their results; see `decisions/schemas/sequences-in-object-parts.md`.
/** Tables and sequences of an object part of a schema definition. */
type ReadObjects<P> = [Extract<P[keyof P], AnySequence>] extends [never]
  ? { tables: P; relations: EmptyRecord; sequences: EmptyRecord }
  : {
      tables: Pick<P, { [K in keyof P]: P[K] extends AnyRowSource ? K : never }[keyof P]>
      relations: EmptyRecord
      sequences: Pick<P, { [K in keyof P]: P[K] extends AnySequence ? K : never }[keyof P]>
    }

/**
 * Defines a schema of the tables and sequences of `parts`, keyed by their names in queries.
 *
 * A part is an object of tables and sequences by their keys or another schema, whose tables, relations, and sequences the new schema includes as they are, so queries built from that schema run on the new one.
 * A key of two different tables or sequences, a table under two keys, and two different definitions of a relation of a table are rejected; the same table or sequence under the same key or the same relation in several parts is one.
 */
export function defineSchema<P extends SchemaPart[]>(
  ...parts: P
): Schema<SchemaTables<P>, SchemaSequences<P>, SchemaPartRelations<P>> {
  const objects = new Map<string, SchemaObject>()
  const keys = new Map<AnyRowSource, string>()
  const relations: RelationMap = new Map()
  /** Adds `object` under `key`, rejecting a key of another object and a table under another key. */
  function addObject(key: string, object: SchemaObject) {
    const noun = isSequence(object) ? "sequence" : "table"
    if (key.startsWith("$")) {
      throw new Error(`${capitalize(noun)} key "${key}" must not start with "$"`)
    }
    const keyObject = objects.get(key)
    if (keyObject !== undefined && keyObject !== object) {
      throw new Error(
        isSequence(keyObject) === isSequence(object)
          ? `${capitalize(noun)} key "${key}" refers to two different ${noun}s`
          : `Key "${key}" refers to both a table and a sequence`,
      )
    }
    objects.set(key, object)
    if (isSequence(object)) {
      return
    }
    // A table has one key, so that the relations declared under a key are the relations of the table.
    const tableKey = keys.get(object)
    if (tableKey !== undefined && tableKey !== key) {
      throw new Error(
        `Table "${object.name}" is included under two keys, "${tableKey}" and "${key}"`,
      )
    }
    keys.set(object, key)
  }
  for (const part of parts) {
    if (isSchema(part)) {
      for (const key of Object.keys(part.$tables)) {
        addObject(key, part.$tables[key]!)
      }
      for (const key of Object.keys(part.$sequences)) {
        addObject(key, part.$sequences[key]!)
      }
      addRelations(relations, part[schemaRelations])
    } else {
      for (const key of Object.keys(part)) {
        addObject(key, part[key]!)
      }
    }
  }
  const tables: Tables = {}
  const sequences: Sequences = {}
  for (const [key, object] of objects) {
    // A key that names a property of the object prototype, such as `__proto__`, is defined as an own property.
    Object.defineProperty(isSequence(object) ? sequences : tables, key, {
      value: object,
      enumerable: true,
    })
  }
  const schema = createSchema(
    Object.freeze(tables),
    keys,
    freezeRelations(relations),
    Object.freeze(sequences),
  )
  return schema as Schema<SchemaTables<P>, SchemaSequences<P>, SchemaPartRelations<P>>
}

/** Creates a schema of tables, relation definitions, and sequences that are already checked; `keys` gives the key of each table. */
function createSchema(
  tables: Tables,
  keys: ReadonlyMap<AnyRowSource, string>,
  relations: SchemaRelations,
  sequences: Sequences,
): Schema<Tables, Sequences, SchemaRelations> {
  const methods: SchemaMembers<Tables, Sequences, SchemaRelations> = {
    [schemaBrand]: true,
    $tables: tables,
    $sequences: sequences,
    [schemaRelations]: relations,
    $relations(declarations: RelationDeclarations<Tables>) {
      const added: RelationMap = new Map()
      addRelations(added, relations)
      for (const key of Object.keys(declarations)) {
        if (!Object.hasOwn(tables, key)) {
          throw new Error(
            `Relations are declared for table key "${key}", which is not part of the schema`,
          )
        }
        const named: Readonly<Record<string, unknown>> | undefined = declarations[key]
        if (named === undefined) {
          continue
        }
        for (const name of Object.keys(named)) {
          addRelation(
            added,
            key,
            name,
            defineRelation(tables[key]!, key, name, named[name], table => keys.get(table)),
          )
        }
      }
      return createSchema(tables, keys, freezeRelations(added), sequences) as never
    },
    $select: selection => startRecordQuery(selection),
  }
  const contexts = createQueryContexts(Object.keys(tables), relations)
  return defineEntries(
    methods,
    tables,
    key => startQuery(tables[key]!, contexts[key]!),
    sequences,
    false,
  )
}

function isSchema(part: SchemaPart): part is AnySchema {
  return schemaBrand in part
}

/**
 * Adds to `methods` a getter per table key that starts a query with `start` and a reference per sequence key, and freezes the result, which is `methods` itself.
 *
 * With `bound`, the result is a `Db`, which the references are bound to.
 * A reference is created once, since it holds no state, unlike a query, which starts with a new table occurrence on each access.
 */
export function defineEntries<M extends object>(
  methods: M,
  tables: Tables,
  start: (key: string) => unknown,
  sequences: Sequences,
  bound: boolean,
) {
  const db = bound ? (methods as unknown as AnyDb) : undefined
  // Without a prototype, a key such as `__proto__` is an own property of the map.
  const properties: PropertyDescriptorMap = Object.create(null)
  for (const key of Object.keys(tables)) {
    properties[key] = { get: () => start(key), enumerable: true }
  }
  for (const key of Object.keys(sequences)) {
    properties[key] = { value: new SequenceReference(sequences[key]!, db), enumerable: true }
  }
  // oxlint-disable-next-line typescript/no-explicit-any -- the entries are typed by the caller
  const result: any = Object.defineProperties(methods, properties)
  return Object.freeze(result)
}
