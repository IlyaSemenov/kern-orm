// Small query builder of another author on top of `kern-db`, which imports only its entry points: it compiles its statements with the SQL fragments of kern-db nested in them, numbering the parameters of both in one statement, and runs them as typed queries of SQL text; prints its statement and its result without PostgreSQL.
import type { AnyType, Database, SqlStatement, TextValue } from "kern-db"
import { createDatabase, param, sql } from "kern-db"
import type { ParameterBinder } from "kern-db/builder"
import {
  bindParameter,
  encodeParameter,
  quoteIdentifier,
  renderFragment,
  SqlFragment,
  startSqlQuery,
} from "kern-db/builder"
import * as t from "kern-db/types"

import { createRecordingDriver } from "./recording-driver.ts"

/** Condition of the builder: a column equal to a value that a type encodes, or a fragment of kern-db. */
export type Condition = { column: string; type: AnyType; value: unknown } | SqlFragment

/** Compiles the select of `columns` of `table` filtered by `conditions`, numbering the parameters of the builder and of its fragments in the order of the text. */
function compileSelect(table: string, columns: string[], conditions: Condition[]): SqlStatement {
  const parameters: TextValue[] = []
  const binder: ParameterBinder = {
    bind: value => bindParameter(parameters, value),
    // The builder binds the parameter of a cast of `param` at each place, as it binds its own values.
    bindParam: (_key, value) => bindParameter(parameters, value),
  }
  let text = `SELECT ${columns.map(quoteIdentifier).join(", ")} FROM ${quoteIdentifier(table)}`
  for (let index = 0; index < conditions.length; index++) {
    const condition = conditions[index]!
    text += index === 0 ? " WHERE " : " AND "
    text +=
      condition instanceof SqlFragment
        ? `(${renderFragment(condition, binder)})`
        : `${quoteIdentifier(condition.column)} = ${binder.bind(encodeParameter(condition.value, condition.type))}::${condition.type.castType}`
  }
  return { text, parameters }
}

/** Starts a query of SQL text of the select, which compiles its statement whenever it executes. */
export function selectFrom(
  database: Database,
  table: string,
  columns: string[],
  conditions: Condition[],
) {
  return startSqlQuery(() => compileSelect(table, columns, conditions), database)
}

const { driver } = createRecordingDriver(() => ({
  columns: ["id", "name"],
  rows: [["7", "Survey"]],
}))
const database = createDatabase({ driver })

/** Typed query of the builder, whose inferred declaration names the query of SQL text of kern-db. */
export const forms = selectFrom(
  database,
  "form",
  ["id", "name"],
  [
    { column: "id", type: t.integer, value: 7 },
    sql`${sql`name = ${"Survey"}`} OR tags @> ${param(t.array(t.text), ["poll"])}`,
  ],
).select({
  id: t.integer,
  name: t.text,
})

console.log(JSON.stringify({ statement: forms.toSQL(), records: await forms }))
await database.close()
