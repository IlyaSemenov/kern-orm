// Exports what a query builder makes of the columns of its tables from a module that imports only `kern-db/builder`, as a module of a builder that takes the columns of its users does.
// The package test emits its declarations in a program of its own, where they name the types of kern-db through `kern-db/builder` alone.
import type { SqlColumn } from "kern-db/builder"
import { createSqlColumns } from "kern-db/builder"

/** Creates the columns of a table that the types do not tell; see the file header. */
export function createColumns(columns: SqlColumn[]) {
  return createSqlColumns(columns)
}

/** Returns the fields that a selection reads from the columns of a table; see the file header. */
export function readFields(columns: SqlColumn[]) {
  return createSqlColumns(columns).fields
}

/** Returns the method that makes the record of the columns of a table `null` without its row, whose declaration names the types of its arguments; see the file header. */
export function getNullable(columns: SqlColumn[]) {
  return createSqlColumns(columns).nullable
}
