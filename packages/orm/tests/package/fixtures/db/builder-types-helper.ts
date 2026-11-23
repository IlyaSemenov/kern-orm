// Exports the columns of a table of a query builder from a module that imports only `kern-db/builder` and `kern-db/types`, as a module of the tables of a builder does.
// The package test emits its declarations in a program of its own, where they name the types of kern-db through these entry points alone.
import { createSqlColumns } from "kern-db/builder"
import * as t from "kern-db/types"

/** Columns of a table with their key; see the file header. */
export const jobColumns = createSqlColumns(
  [
    { key: "id", name: "id", type: t.integer },
    { key: "lockedBy", name: "locked_by", type: t.text.nullable() },
  ],
  { alias: "j", key: ["id"] },
)

/** Columns of a record that is `null` without its row; see the file header. */
export const joinedJobColumns = jobColumns.nullable()
