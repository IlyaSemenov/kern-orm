// Comparison of the tables of a `Db` with the catalog of its PostgreSQL schema, such as in tests after migrating.
import type { Database } from "kern-db"
import { param } from "kern-db"
import * as t from "kern-db/types"

import type { AnyDb } from "../execution/db"
import type { RelationDefinition } from "../schema/relation"
import { collectDefinitions, formatRelationName } from "../schema/relation"
import { schemaRelations } from "../schema/schema"
import type { AnyColumn } from "../table/column"
import type { AnyTable, KeyColumns } from "../table/table"

/** Mismatch of a table of a `Db` and the database. */
export interface TableMismatch {
  /** Key of the table in the schema of the `Db`. */
  readonly table: string
  /** What does not match, such as a missing column. */
  readonly message: string
}

/** Relation of the catalog: a table or a view, with its columns by name. */
interface CatalogRelation {
  /** `relkind` of `pg_class`. */
  readonly kind: string
  readonly columns: Map<string, CatalogColumn>
}

interface CatalogColumn {
  /** `format_type` of the type of the column, with its type modifier. */
  readonly type: string
  /** Whether the column has a not-null constraint, which rejects `NULL` of new rows even when it is `NOT VALID`. */
  readonly rejectsNull: boolean
  /** Whether the column has a valid not-null constraint, so that no existing row holds `NULL`. */
  readonly notNullValidated: boolean
  /** Whether an insert that omits the column gives it a value: a default, an identity, or a generated value. */
  readonly hasDefault: boolean
}

/** Unique index of a table of the catalog. */
interface CatalogIndex {
  readonly name: string
  /** Names of its key columns, without `INCLUDE` columns and expressions. */
  readonly columns: readonly string[]
  readonly hasExpressions: boolean
  /** Its expression as `pg_get_indexdef` gives it, such as `(true)`, when it is its only key column. */
  readonly expression: string | null
  readonly partial: boolean
  readonly immediate: boolean
  readonly valid: boolean
}

/** Foreign key of a table of the catalog. */
interface CatalogForeignKey {
  readonly name: string
  readonly target: string
  readonly targetSchema: string
  /** Names of its columns, in the order of `to`. */
  readonly from: readonly string[]
  readonly to: readonly string[]
  readonly deferrable: boolean
  readonly validated: boolean
  readonly enforced: boolean
  readonly period: boolean
}

/** Catalog of the tables of a `Db` in its PostgreSQL schema. */
interface Catalog {
  readonly schemaName: string
  readonly relations: Map<string, CatalogRelation>
  readonly indexes: Map<string, CatalogIndex[]>
  readonly foreignKeys: Map<string, CatalogForeignKey[]>
  /** `format_type` of each SQL type of the columns, or `null` for a type that does not exist. */
  readonly types: Map<string, string | null>
}

// `to_regtypemod` appeared in PostgreSQL 17.
const minimumServerVersion = 170000

/**
 * Finds the mismatches of the tables of `db` and its PostgreSQL schema, such as a missing column or a key without a unique index, resolving to an empty array when they match.
 *
 * It reads the catalog in the ambient transaction, such as a test transaction in which migrations have created the tables, and requires PostgreSQL 17 or newer.
 * It checks that each table or view exists with the columns of the table under their physical names and of their types; for a table, also the nullability of each column, a default of each column marked with `hasDefault()`, no other column that every insert must give, a unique index of each key, a unique index of `(true)` of a singleton table, and a foreign key of each required relation `one` to a table.
 */
export async function findTableMismatches(db: AnyDb): Promise<TableMismatch[]> {
  const database = db.$database
  const tables = db.$schema.$tables as Record<string, AnyTable>
  const catalog = await readCatalog(database, db.$schemaName, Object.values(tables))
  const mismatches: TableMismatch[] = []
  for (const key of Object.keys(tables)) {
    for (const message of findTableProblems(tables[key]!, catalog)) {
      mismatches.push({ table: key, message })
    }
  }
  for (const definition of collectDefinitions(db.$schema[schemaRelations])) {
    const message = findRelationProblem(definition, catalog)
    if (message !== undefined) {
      mismatches.push({ table: definition.key, message })
    }
  }
  return mismatches
}

/** Reads the catalog of `tables` in PostgreSQL schema `schemaName`, or in `current_schema()` when it is `undefined`. */
async function readCatalog(
  database: Database,
  schemaName: string | undefined,
  tables: readonly AnyTable[],
): Promise<Catalog> {
  const server = await database.query`
    SELECT current_setting('server_version_num')::integer AS version, current_schema() AS schema
  `
    .select({ version: t.integer, schema: t.text.nullable() })
    .take()
  if (server.version < minimumServerVersion) {
    throw new Error(
      `findTableMismatches requires PostgreSQL 17 or newer, but the server is ${server.version}`,
    )
  }
  const resolvedSchema = schemaName ?? server.schema
  if (resolvedSchema === null) {
    throw new Error(
      "Cannot resolve the PostgreSQL schema: current_schema() is NULL, since no schema of the search path exists",
    )
  }
  const names = [...new Set(tables.map(table => table.name))]
  const sqlTypes = new Set<string>()
  for (const table of tables) {
    for (const column of Object.values(table.columns)) {
      sqlTypes.add(column.type.sqlType)
    }
  }
  return {
    schemaName: resolvedSchema,
    relations: await readRelations(database, resolvedSchema, names),
    indexes: await readIndexes(database, resolvedSchema, names),
    foreignKeys: await readForeignKeys(database, resolvedSchema, names),
    types: await resolveTypes(database, [...sqlTypes]),
  }
}

/** Reads the tables and views of `names` in `schemaName` with their columns. */
async function readRelations(
  database: Database,
  schemaName: string,
  names: string[],
): Promise<Map<string, CatalogRelation>> {
  // PostgreSQL 18 sets `attnotnull` also for a `NOT VALID` not-null constraint, which existing rows may break.
  const rows = await database.query`
    SELECT relation.relname::text AS name, relation.relkind::text AS kind,
      attribute.attname::text AS column_name,
      pg_catalog.format_type(attribute.atttypid, attribute.atttypmod) AS type,
      attribute.attnotnull AS rejects_null,
      attribute.attnotnull AND NOT EXISTS (
        SELECT FROM pg_catalog.pg_constraint
        WHERE conrelid = relation.oid AND contype = 'n' AND conkey = ARRAY[attribute.attnum] AND NOT convalidated
      ) AS not_null_validated,
      attribute.atthasdef OR attribute.attidentity <> '' OR attribute.attgenerated <> '' AS has_default
    FROM pg_catalog.pg_class AS relation
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    LEFT JOIN pg_catalog.pg_attribute AS attribute
      ON attribute.attrelid = relation.oid AND attribute.attnum > 0 AND NOT attribute.attisdropped
    WHERE namespace.nspname = ${schemaName} AND relation.relname = ANY(${param(t.array(t.text), names)})
  `.select({
    name: t.text,
    kind: t.text,
    column_name: t.text.nullable(),
    type: t.text.nullable(),
    rejects_null: t.boolean.nullable(),
    not_null_validated: t.boolean.nullable(),
    has_default: t.boolean.nullable(),
  })
  const relations = new Map<string, CatalogRelation>()
  for (const row of rows) {
    let relation = relations.get(row.name)
    if (relation === undefined) {
      relation = { kind: row.kind, columns: new Map() }
      relations.set(row.name, relation)
    }
    // A relation without columns has one row without a column.
    if (row.column_name !== null) {
      relation.columns.set(row.column_name, {
        type: row.type!,
        rejectsNull: row.rejects_null!,
        notNullValidated: row.not_null_validated!,
        hasDefault: row.has_default!,
      })
    }
  }
  return relations
}

/** Reads the unique indexes of the tables of `names` in `schemaName` by the names of their tables. */
async function readIndexes(
  database: Database,
  schemaName: string,
  names: string[],
): Promise<Map<string, CatalogIndex[]>> {
  const rows = await database.query`
    SELECT relation.relname::text AS table_name, index_relation.relname::text AS name,
      ARRAY(
        SELECT attribute.attname::text
        FROM generate_series(0, index.indnkeyatts - 1) AS ordinal
        JOIN pg_catalog.pg_attribute AS attribute
          ON attribute.attrelid = index.indrelid AND attribute.attnum = index.indkey[ordinal]
        ORDER BY ordinal
      ) AS columns,
      index.indexprs IS NOT NULL AS has_expressions,
      CASE WHEN index.indnkeyatts = 1 AND index.indkey[0] = 0
        THEN pg_catalog.pg_get_indexdef(index.indexrelid, 1, true)
      END AS expression,
      index.indpred IS NOT NULL AS is_partial,
      index.indimmediate AS is_immediate,
      index.indisvalid AND index.indisready AND index.indislive AS is_valid
    FROM pg_catalog.pg_index AS index
    JOIN pg_catalog.pg_class AS relation ON relation.oid = index.indrelid
    JOIN pg_catalog.pg_class AS index_relation ON index_relation.oid = index.indexrelid
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    WHERE index.indisunique AND namespace.nspname = ${schemaName} AND relation.relname = ANY(${param(t.array(t.text), names)})
    ORDER BY index_relation.relname
  `.select({
    table_name: t.text,
    name: t.text,
    columns: t.array(t.text),
    has_expressions: t.boolean,
    expression: t.text.nullable(),
    is_partial: t.boolean,
    is_immediate: t.boolean,
    is_valid: t.boolean,
  })
  const indexes = new Map<string, CatalogIndex[]>()
  for (const row of rows) {
    addToGroup(indexes, row.table_name, {
      name: row.name,
      columns: row.columns,
      hasExpressions: row.has_expressions,
      expression: row.expression,
      partial: row.is_partial,
      immediate: row.is_immediate,
      valid: row.is_valid,
    })
  }
  return indexes
}

/** Reads the foreign keys of the tables of `names` in `schemaName` by the names of their tables. */
async function readForeignKeys(
  database: Database,
  schemaName: string,
  names: string[],
): Promise<Map<string, CatalogForeignKey[]>> {
  // `conenforced` and `conperiod` appeared in PostgreSQL 18, so they are read from the row as JSON, which lacks them before.
  const rows = await database.query`
    SELECT relation.relname::text AS table_name, constraint_.conname::text AS name,
      target.relname::text AS target_name, target_namespace.nspname::text AS target_schema,
      ARRAY(
        SELECT attribute.attname::text
        FROM unnest(constraint_.conkey) WITH ORDINALITY AS key_column(number, ordinal)
        JOIN pg_catalog.pg_attribute AS attribute
          ON attribute.attrelid = constraint_.conrelid AND attribute.attnum = key_column.number
        ORDER BY key_column.ordinal
      ) AS from_columns,
      ARRAY(
        SELECT attribute.attname::text
        FROM unnest(constraint_.confkey) WITH ORDINALITY AS key_column(number, ordinal)
        JOIN pg_catalog.pg_attribute AS attribute
          ON attribute.attrelid = constraint_.confrelid AND attribute.attnum = key_column.number
        ORDER BY key_column.ordinal
      ) AS to_columns,
      constraint_.condeferrable AS is_deferrable,
      constraint_.convalidated AS is_validated,
      coalesce((to_jsonb(constraint_) ->> 'conenforced')::boolean, true) AS is_enforced,
      coalesce((to_jsonb(constraint_) ->> 'conperiod')::boolean, false) AS is_period
    FROM pg_catalog.pg_constraint AS constraint_
    JOIN pg_catalog.pg_class AS relation ON relation.oid = constraint_.conrelid
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    JOIN pg_catalog.pg_class AS target ON target.oid = constraint_.confrelid
    JOIN pg_catalog.pg_namespace AS target_namespace ON target_namespace.oid = target.relnamespace
    WHERE constraint_.contype = 'f' AND namespace.nspname = ${schemaName} AND relation.relname = ANY(${param(t.array(t.text), names)})
    ORDER BY constraint_.conname
  `.select({
    table_name: t.text,
    name: t.text,
    target_name: t.text,
    target_schema: t.text,
    from_columns: t.array(t.text),
    to_columns: t.array(t.text),
    is_deferrable: t.boolean,
    is_validated: t.boolean,
    is_enforced: t.boolean,
    is_period: t.boolean,
  })
  const foreignKeys = new Map<string, CatalogForeignKey[]>()
  for (const row of rows) {
    addToGroup(foreignKeys, row.table_name, {
      name: row.name,
      target: row.target_name,
      targetSchema: row.target_schema,
      from: row.from_columns,
      to: row.to_columns,
      deferrable: row.is_deferrable,
      validated: row.is_validated,
      enforced: row.is_enforced,
      period: row.is_period,
    })
  }
  return foreignKeys
}

/**
 * Resolves `sqlTypes` in the search path of the connection, as the casts of queries do, to `format_type` of their types and type modifiers, or to `null` for a type that does not exist.
 *
 * `format_type` gives one text of each type and modifier, qualified when the search path does not find the type, so that aliases, such as `int4` and `integer`, give the same text.
 */
async function resolveTypes(
  database: Database,
  sqlTypes: string[],
): Promise<Map<string, string | null>> {
  const rows = await database.query`
    SELECT sql_type, pg_catalog.format_type(to_regtype(sql_type), to_regtypemod(sql_type)) AS type
    FROM unnest(${param(t.array(t.text), sqlTypes)}) AS sql_type
  `.select({ sql_type: t.text, type: t.text.nullable() })
  const types = new Map<string, string | null>()
  for (const row of rows) {
    types.set(row.sql_type, row.type)
  }
  return types
}

/** Returns the problems of `table` in `catalog`, such as a missing column. */
function findTableProblems(table: AnyTable, catalog: Catalog): string[] {
  const relation = catalog.relations.get(table.name)
  if (relation === undefined) {
    return [`Table "${table.name}" does not exist in schema "${catalog.schemaName}"`]
  }
  const isView = isViewKind(relation.kind)
  if (!isView && !isTableKind(relation.kind)) {
    return [`"${table.name}" in schema "${catalog.schemaName}" is not a table or a view`]
  }
  const problems: string[] = []
  const definedNames = new Set<string>()
  for (const key of Object.keys(table.columns)) {
    const column = table.columns[key]!
    const name = getColumnName(column, key)
    definedNames.add(name)
    const subject = formatColumn(key, name)
    const actual = relation.columns.get(name)
    if (actual === undefined) {
      problems.push(`${subject} does not exist`)
      continue
    }
    const expectedType = catalog.types.get(column.type.sqlType)
    if (expectedType === null) {
      problems.push(`${subject} is of type "${column.type.sqlType}", which does not exist`)
    } else if (expectedType !== actual.type) {
      problems.push(`${subject} is of type ${actual.type} rather than ${expectedType}`)
    }
    // The catalog does not tell the nullability of the columns of a view or whether an insert into it gives them values.
    if (isView) {
      continue
    }
    if (column.type.isNullable && actual.rejectsNull) {
      problems.push(`${subject} is NOT NULL, but the table defines it as nullable`)
    } else if (!column.type.isNullable && !actual.notNullValidated) {
      problems.push(
        actual.rejectsNull
          ? `${subject} has a NOT VALID not-null constraint, so existing rows may hold NULL, but the table defines it as not nullable`
          : `${subject} is nullable, but the table defines it as not nullable`,
      )
    }
    // A default of a column without `hasDefault()` is not a mismatch, since it breaks no insert or query of the table.
    if (column.attributes.hasDefault && !actual.hasDefault) {
      problems.push(`${subject} has no default, but the table marks it with hasDefault()`)
    }
  }
  if (isView) {
    return problems
  }
  for (const [name, actual] of relation.columns) {
    if (!definedNames.has(name) && actual.rejectsNull && !actual.hasDefault) {
      problems.push(
        `Column "${name}" is NOT NULL without a default, so every insert of the table, which does not define it, fails`,
      )
    }
  }
  const indexes = catalog.indexes.get(table.name) ?? []
  const { primaryKey, unique } = table.keys
  if (primaryKey !== undefined) {
    pushDefined(problems, findKeyProblem(table, "Primary key", primaryKey, indexes))
  }
  for (const key of unique) {
    pushDefined(problems, findKeyProblem(table, "Unique key", key, indexes))
  }
  if (table.singleton) {
    pushDefined(
      problems,
      findArbiterProblem(
        "Singleton table",
        "unique index of (true)",
        indexes.filter(index => index.expression === "(true)"),
      ),
    )
  }
  return problems
}

/**
 * Returns the problem of key `columns` of `table`, or `undefined` when a unique index backs it.
 *
 * The indexes are those that PostgreSQL infers as the arbiters of `ON CONFLICT` of the columns of the key, which `onConflict` and `upsert` build: of the same set of columns, in any order, without expressions or a predicate, and valid.
 * One of them must exist, and none may be deferrable, since PostgreSQL rejects the insert of a deferrable arbiter.
 */
function findKeyProblem(
  table: AnyTable,
  kind: string,
  columns: KeyColumns,
  indexes: readonly CatalogIndex[],
): string | undefined {
  const names = new Set(columns.map(key => getColumnName(table.columns[key]!, key)))
  // An index may repeat a column, such as `(code, code)`, which PostgreSQL infers for `ON CONFLICT (code)`.
  const matching = indexes.filter(index => {
    const indexColumns = new Set(index.columns)
    return (
      !index.hasExpressions &&
      indexColumns.size === names.size &&
      index.columns.every(name => names.has(name))
    )
  })
  return findArbiterProblem(`${kind} (${columns.join(", ")})`, "unique index", matching)
}

/** Returns the problem of `subject` when the indexes of `matching` cannot serve as its arbiters of `ON CONFLICT`, or `undefined` when they can. */
function findArbiterProblem(
  subject: string,
  description: string,
  matching: readonly CatalogIndex[],
): string | undefined {
  const arbiters = matching.filter(index => index.valid && !index.partial)
  const deferrable = arbiters.find(index => !index.immediate)
  if (deferrable !== undefined) {
    return `${subject} has deferrable ${description} "${deferrable.name}", which ON CONFLICT rejects as an arbiter`
  }
  if (arbiters.length > 0) {
    return undefined
  }
  if (matching.length === 0) {
    return `${subject} has no ${description}`
  }
  const index = matching[0]!
  const flaws: string[] = []
  if (index.partial) {
    flaws.push("partial")
  }
  if (!index.valid) {
    flaws.push("not valid")
  }
  return `${subject} has no usable ${description}: "${index.name}" is ${flaws.join(" and ")}`
}

/** Returns the problem of a required relation `one` of `definition` to a table, or `undefined` when a foreign key backs it or the relation is not checked. */
function findRelationProblem(definition: RelationDefinition, catalog: Catalog): string | undefined {
  if (definition.kind !== "one" || !definition.required) {
    return undefined
  }
  const { source, target } = definition
  // A missing or another relation of either table is the problem of that table, and a view has no foreign keys.
  for (const table of [source, target]) {
    const relation = catalog.relations.get(table.name)
    if (relation === undefined || !isTableKind(relation.kind)) {
      return undefined
    }
  }
  const pairs = new Set<string>()
  for (let index = 0; index < definition.from.length; index++) {
    const fromKey = definition.from[index]!
    const toKey = definition.to[index]!
    pairs.add(
      formatPair(
        getColumnName(source.columns[fromKey]!, fromKey),
        getColumnName(target.columns[toKey]!, toKey),
      ),
    )
  }
  // The pairs of columns are compared as a set, since the order of the columns of a foreign key does not change what it guarantees.
  const matching = (catalog.foreignKeys.get(source.name) ?? []).filter(
    foreignKey =>
      foreignKey.target === target.name &&
      foreignKey.targetSchema === catalog.schemaName &&
      foreignKey.from.length === pairs.size &&
      foreignKey.from.every((name, index) => pairs.has(formatPair(name, foreignKey.to[index]!))),
  )
  const subject = `Required relation ${formatRelationName(definition.key, definition.name)}`
  if (
    matching.some(
      foreignKey =>
        !foreignKey.deferrable && foreignKey.validated && foreignKey.enforced && !foreignKey.period,
    )
  ) {
    return undefined
  }
  if (matching.length === 0) {
    return `${subject} has no foreign key of its columns`
  }
  const foreignKey = matching[0]!
  const flaws: string[] = []
  if (foreignKey.deferrable) {
    flaws.push("deferrable")
  }
  if (!foreignKey.validated) {
    flaws.push("not valid")
  }
  if (!foreignKey.enforced) {
    flaws.push("not enforced")
  }
  if (foreignKey.period) {
    flaws.push("of a period")
  }
  return `${subject} has no usable foreign key of its columns: "${foreignKey.name}" is ${flaws.join(" and ")}`
}

/** Returns the physical name of `column` under `key`. */
function getColumnName(column: AnyColumn, key: string): string {
  return column.attributes.name ?? key
}

/** Returns the subject of a message of the column of `key`, with its physical name when it differs. */
function formatColumn(key: string, name: string): string {
  return key === name ? `Column "${key}"` : `Column "${key}" (${name})`
}

/** Returns a key of a pair of the names of a source column and a target column; a name cannot contain a NUL character. */
function formatPair(from: string, to: string): string {
  return `${from}\0${to}`
}

/** Whether `relkind` is of a table: ordinary, partitioned, or foreign. */
function isTableKind(kind: string): boolean {
  return kind === "r" || kind === "p" || kind === "f"
}

/** Whether `relkind` is of a view or a materialized view. */
function isViewKind(kind: string): boolean {
  return kind === "v" || kind === "m"
}

function addToGroup<T>(groups: Map<string, T[]>, key: string, item: T): void {
  const group = groups.get(key)
  if (group === undefined) {
    groups.set(key, [item])
  } else {
    group.push(item)
  }
}

function pushDefined(problems: string[], problem: string | undefined): void {
  if (problem !== undefined) {
    problems.push(problem)
  }
}
