# Building Query Builders

::: info For library authors
This page is for authors of libraries that compile SQL on top of kern-db, such as a query builder or an ORM.
To run SQL statements in an application, use [`database.query`](./sql), and to query tables with results typed from their definitions, use the [ORM](../orm/getting-started).
:::

To build a query builder of your own on kern-db, as kern-orm is built on it, compile its statements with `kern-db/builder` and run them as queries of SQL text.
Your builder then runs its statements in the [transactions](./transactions) of a database, decodes their rows with the [types](./types) of kern-db, and accepts the [SQL fragments](./sql#sql-fragments) of your users:

```ts [src/select-from.ts]
import type { AnyType, Database, SqlStatement, TextValue } from "kern-db"
import type { ParameterBinder } from "kern-db/builder"
import {
  bindParameter,
  encodeParameter,
  quoteIdentifier,
  renderFragment,
  SqlFragment,
  startSqlQuery,
} from "kern-db/builder"

/** Condition of a column equal to a value of its type, or a SQL fragment. */
export type Condition = { column: string; type: AnyType; value: unknown } | SqlFragment

function compileSelect(table: string, columns: string[], conditions: Condition[]): SqlStatement {
  const parameters: TextValue[] = []
  const binder: ParameterBinder = {
    bind: value => bindParameter(parameters, value),
    bindParam: (_key, value) => bindParameter(parameters, value),
  }
  let text = `SELECT ${columns.map(quoteIdentifier).join(", ")} FROM ${quoteIdentifier(table)}`
  for (const [index, condition] of conditions.entries()) {
    text += index === 0 ? " WHERE " : " AND "
    if (condition instanceof SqlFragment) {
      text += `(${renderFragment(condition, binder)})`
    } else {
      const placeholder = binder.bind(encodeParameter(condition.value, condition.type))
      text += `${quoteIdentifier(condition.column)} = ${placeholder}`
    }
  }
  return { text, parameters }
}

export function selectFrom(
  database: Database,
  table: string,
  columns: string[],
  conditions: Condition[],
) {
  return startSqlQuery(() => compileSelect(table, columns, conditions), database)
}
```

Your users then await its queries and call `select`, `get`, `pluck`, `take`, `optional`, and `nullable` on them, as on [`database.query`](./sql):

```ts
import { sql } from "kern-db"
import * as t from "kern-db/types"

import { selectFrom } from "./select-from"

const forms = await selectFrom(
  database,
  "form",
  ["id", "name"],
  [{ column: "published", type: t.boolean, value: true }, sql`name ILIKE ${"%survey%"}`],
).select({
  id: t.uuid,
  name: t.text,
})
// forms: { id: string; name: string }[]
```

The statement numbers the parameters of the builder and of the fragment in one sequence: `SELECT "id", "name" FROM "form" WHERE "published" = $1 AND (name ILIKE $2)`.

`startSqlQuery` compiles the statement with your function, a `StatementSource`, each time the query executes or `toSQL` is called, so read in the function what may change between runs, such as the PostgreSQL schema of the current tenant.

To tell a query of SQL text, such as of `database.query`, from the other values that your builder takes, such as to reject it with an error of your own, check `instanceof SqlQuery`.

## Statements

Compile the parts of a statement by the rules of kern-db:

- Quote names with `quoteIdentifier`, as [`identifier`](./sql#names-known-at-runtime) quotes them.
- Add each parameter with `bindParameter`, which appends its value to the parameters of the statement and returns its placeholder, such as `$1`, and rejects more parameters than the 65535 that PostgreSQL takes.
- Encode a value with `encodeParameter`: with a type of kern-db, as the type encodes it, such as an array or JSON, and with `undefined` instead of a type, as `sql` encodes an interpolated value.
  It encodes `null` as `NULL` and rejects `undefined`.

To reject a value that a parameter takes only with a type, such as an object, when your users pass it to the builder rather than when the statement compiles, call `assertUntypedValue` with it.

## Fragments of your users

Render a fragment of `sql`, `identifier`, or `param` with `renderFragment` and a `ParameterBinder` of your statement: it returns the SQL text of the fragment and adds its parameters through the binder in the order of the text, among the parameters of your statement.
Tell a fragment from the other values that your builder takes with `instanceof SqlFragment`.

`bind` of the binder receives the value of a parameter that `sql` interpolates, and `bindParam` the value of a [`param`](./sql#json-and-arrays) fragment, with a `key` that is the same object wherever the statement repeats the fragment.
A `param` fragment casts its parameter, which gives it the same type wherever a statement repeats the fragment.
When your statement repeats an expression that PostgreSQL must find equal, such as a key of `GROUP BY` in the select list, give each `key` one placeholder:

```ts
const placeholders = new Map<object, string>()
const binder: ParameterBinder = {
  bind: value => bindParameter(parameters, value),
  bindParam(key, value) {
    let placeholder = placeholders.get(key)
    if (placeholder === undefined) {
      placeholder = bindParameter(parameters, value)
      placeholders.set(key, placeholder)
    }
    return placeholder
  },
}
```

Give each call of `bind` a placeholder of its own: PostgreSQL types a parameter without a cast by its place in the statement.

## Results of your own

When your builder returns results that a query of SQL text does not decode, such as related records nested as JSON, execute the statement with `database.execute` and decode its rows yourself.
It runs the statement in the current transaction and returns its rows as the PostgreSQL text representations of their values, with `null` for `NULL`; decode a value with `decode` of its type.

Return the rows of a query in a rows mode of `ResultMode`, as kern-db does: `many` as an array, and one row in `one`, `nullable`, or `optional`.
For a query of one row, take the row with `takeOnlyRow`.
It rejects several rows, and rejects a missing row with `NotFoundError` in `one`.
Without the row, it returns `undefined`: return `toMissingResult` then, which gives `null` in `nullable` and `undefined` in `optional`:

```ts
import type { Database, SqlStatement, TextValue } from "kern-db"
import type { ResultMode } from "kern-db/builder"
import { takeOnlyRow, toMissingResult } from "kern-db/builder"

async function executeOne<T>(
  database: Database,
  statement: SqlStatement,
  mode: ResultMode,
  decodeRow: (row: readonly TextValue[]) => T,
): Promise<T | null | undefined> {
  const { rows } = await database.execute(statement)
  const row = takeOnlyRow(mode, rows)
  if (row === undefined) {
    return toMissingResult(mode)
  }
  return decodeRow(row)
}
```

When a query returns the values of a column rather than records, change its mode with `toValueRows`, which gives `optional` for `nullable`, as `pluck` does: `null` of a missing row would read as a `NULL` value.

Throw the failures of a result as `ResultDecodeError`, so that your users handle them as for the queries of kern-db.
Wrap a failure to decode a value with `createFieldDecodeError` and the path of the value, such as `[2].label` for `label` of the third row.
Wrap another failure of the result, such as of a conversion of a record, with `createResultDecodeError`:

```ts
try {
  record[key] = text === null ? null : type.decode(text)
} catch (error) {
  throw createFieldDecodeError(`[${index}].${key}`, error)
}
```

When your users choose the keys of the records, reject a key for which `isRecordKey` returns `false`, such as `__proto__`: assigning it would change the prototype of the record instead of adding a field.

## Depending on kern-db

Require `kern-db` in `peerDependencies` of your package, by a range of one minor line, such as `^0.1.0`:

- Your builder recognizes only the fragments, types, and queries of its own copy of kern-db, so it works only with the copy that the application uses; a peer dependency shares that copy when the version of kern-db of the application is in your range.
- Before 1.0, a minor version of kern-db may change `kern-db/builder`.
