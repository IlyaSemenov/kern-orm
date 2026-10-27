import { createQueryContexts } from "../query/relations"
import type { EmptyRecord, InitialQueryState, SelectQuery } from "../query/select"
import { startQuery } from "../query/select"
import type { AnyTable } from "../table/table"

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

const schemaBrand = Symbol("kern-orm.schema")

/** Key of the relation definitions of a schema, which composition reads. */
export const schemaRelations = Symbol("kern-orm.schema.relations")

/** Tables by their keys; a key must not start with `$`, which is reserved for schema and `Db` members. */
export type Tables = Record<string, AnyTable>

/**
 * Immutable collection of tables and their relations with query entry points.
 *
 * A schema is not bound to a database, so queries built from it can be defined at module level.
 * A `Db` can execute such a query if its schema contains the tables and the selected relations of the query and every bound nested query belongs to that `Db`.
 */
export type Schema<T extends Tables, R extends SchemaRelations = EmptyRecord> = SchemaEntries<
  T,
  R
> &
  SchemaMembers<T, R>

/** Query entry points; each access starts a query over a new table occurrence. */
type SchemaEntries<T extends Tables, R extends SchemaRelations> = {
  readonly [K in keyof T]: SelectQuery<InitialQueryState<T[K], TableContext<R, K>>>
}

/** Members of a schema that composition reads: its tables and the relations of its tables. */
interface SchemaContents<T extends Tables, R extends SchemaRelations> {
  readonly [schemaBrand]: true
  /** Tables of the schema by their keys. */
  readonly $tables: T
  /** Relation definitions by table key and relation name. */
  readonly [schemaRelations]: R
}

interface SchemaMembers<T extends Tables, R extends SchemaRelations> extends SchemaContents<T, R> {
  // Typed by `this` rather than by `T` and `R`, so that the method is the same in every schema, and comparing schemas, such as of a `Db` passed as a `DbOf`, does not compare its generic signatures.
  /**
   * Creates a schema of the same tables with the relations of `relations` added, declared with `many` and `one` by their names under the keys of their tables.
   *
   * A relation refers to a table of the schema by columns of SQL types that `=` compares; a relation that the schema already has is rejected.
   */
  $relations<S extends AnySchema, D extends RelationDeclarations<S["$tables"]>>(
    this: S,
    relations: D & CheckDeclarations<S["$tables"], D>,
  ): Schema<
    S["$tables"],
    MergeRelations<S[typeof schemaRelations] & DeclaredRelations<S["$tables"], D>>
  >
}

/** Schema of any tables and relations. */
export type AnySchema = SchemaContents<Tables, SchemaRelations>

/** Part of a schema definition: an object of tables by their keys, or a schema whose tables and relations it includes. */
export type SchemaPart = Tables | AnySchema

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

/** Tables and relations of the parts of a schema definition, intersected. */
interface PartContents {
  readonly tables: Tables
  readonly relations: SchemaRelations
}

// Both recursive branches are tail calls, so that TypeScript composes up to 1000 parts instead of about 50.
type ComposeParts<
  P extends readonly SchemaPart[],
  Composed extends PartContents = { tables: EmptyRecord; relations: EmptyRecord },
> = P extends readonly [infer First extends SchemaPart, ...infer Rest extends readonly SchemaPart[]]
  ? ComposeParts<Rest, Composed & ReadPart<First>>
  : P extends readonly [...infer Rest extends readonly SchemaPart[], infer Last extends SchemaPart]
    ? ComposeParts<Rest, Composed & ReadPart<Last>>
    : Composed

type ReadPart<P extends SchemaPart> =
  // oxlint-disable-next-line typescript/no-explicit-any -- the relations of any schema
  P extends SchemaContents<infer T, any>
    ? { tables: T; relations: P[typeof schemaRelations] }
    : { tables: P; relations: EmptyRecord }

/**
 * Defines a schema of the tables of `parts`, keyed by their names in queries.
 *
 * A part is an object of tables by their keys or another schema, whose tables and relations the new schema includes as they are, so queries built from that schema run on the new one.
 * A key of two different tables, a table under two keys, and two different definitions of a relation of a table are rejected; the same table under the same key or the same relation in several parts is one.
 */
export function defineSchema<P extends SchemaPart[]>(
  ...parts: P
): Schema<SchemaTables<P>, SchemaPartRelations<P>> {
  const tables = new Map<string, AnyTable>()
  const keys = new Map<AnyTable, string>()
  const relations: RelationMap = new Map()
  for (const part of parts) {
    const partTables = isSchema(part) ? part.$tables : part
    for (const key of Object.keys(partTables)) {
      if (key.startsWith("$")) {
        throw new Error(`Table key "${key}" must not start with "$"`)
      }
      const table = partTables[key]!
      const keyTable = tables.get(key)
      if (keyTable !== undefined && keyTable !== table) {
        throw new Error(`Table key "${key}" refers to two different tables`)
      }
      // A table has one key, so that the relations declared under a key are the relations of the table.
      const tableKey = keys.get(table)
      if (tableKey !== undefined && tableKey !== key) {
        throw new Error(
          `Table "${table.name}" is included under two keys, "${tableKey}" and "${key}"`,
        )
      }
      tables.set(key, table)
      keys.set(table, key)
    }
    if (isSchema(part)) {
      addRelations(relations, part[schemaRelations])
    }
  }
  const schema = createSchema(
    Object.freeze(Object.fromEntries(tables)),
    keys,
    freezeRelations(relations),
  )
  return schema as Schema<SchemaTables<P>, SchemaPartRelations<P>>
}

/** Creates a schema of tables and relation definitions that are already checked; `keys` gives the key of each table. */
function createSchema(
  tables: Tables,
  keys: ReadonlyMap<AnyTable, string>,
  relations: SchemaRelations,
): Schema<Tables, SchemaRelations> {
  const methods: SchemaMembers<Tables, SchemaRelations> = {
    [schemaBrand]: true,
    $tables: tables,
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
      return createSchema(tables, keys, freezeRelations(added)) as never
    },
  }
  const contexts = createQueryContexts(Object.keys(tables), relations)
  return defineEntries(methods, tables, key => startQuery(tables[key]!, contexts[key]!))
}

function isSchema(part: SchemaPart): part is AnySchema {
  return schemaBrand in part
}

/** Adds a getter per table key to `methods` that starts a query with `start`, and freezes the result. */
export function defineEntries<M extends object>(
  methods: M,
  tables: Tables,
  start: (key: string) => unknown,
) {
  // oxlint-disable-next-line typescript/no-explicit-any -- the entries are typed by the caller
  const result: any = Object.defineProperties(
    methods,
    Object.fromEntries(
      Object.keys(tables).map(key => [key, { get: () => start(key), enumerable: true }]),
    ),
  )
  return Object.freeze(result)
}
