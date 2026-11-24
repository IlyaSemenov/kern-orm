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
It runs the statement on any `StatementExecutor`, such as a driver or a connection instead of the database, as [`queryOn`](./sql#statements-on-a-connection-or-a-driver) does.

To tell a query of SQL text, such as of `database.query`, from the other values that your builder takes, such as to reject it with an error of your own, check `instanceof SqlQuery`.

## Statements

Compile the parts of a statement by the rules of kern-db:

- Quote names with `quoteIdentifier`, as [`identifier`](./sql#names-known-at-runtime) quotes them.
- Add each parameter with `bindParameter`, which appends its value to the parameters of the statement and returns its placeholder, such as `$1`, and rejects more parameters than the 65535 that PostgreSQL takes.
- Encode a value with `encodeParameter`: with a type of kern-db, as the type encodes it, such as an array or JSON, and with `undefined` instead of a type, as `sql` encodes an interpolated value.
  It encodes `null` as `NULL` and rejects `undefined`.

To reject a value that a parameter takes only with a type, such as an object, when your users pass it to the builder rather than when the statement compiles, call `assertUntypedValue` with it.

Select each value that a statement returns by the [read expression](./custom-types#reading-values-by-an-expression) of its type, if the type has one: `type.read` returns its SQL for the SQL of the value, such as of a quoted column.
Pass it the SQL of one operand, in parentheses when it is a compound expression, such as `(a + b)`, since the expression may place it beside an operator.
Keep the value itself where the statement only computes with it, such as in a condition or a sort key.

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

## Columns of your tables

To let your users select the rows of a table of your builder in a statement of SQL text, such as of `database.query`, without listing its columns twice, create the columns of the table with `createSqlColumns`:

```ts
import { createSqlColumns } from "kern-db/builder"
import * as t from "kern-db/types"

const job = createSqlColumns(
  [
    { key: "id", name: "id", type: t.integer },
    { key: "runAt", name: "run_at", type: t.timestamptz },
  ],
  { alias: "j", key: ["id"] },
)

const claimed = await database.query`
  UPDATE job j SET locked_by = ${worker} WHERE j.id = ${jobId}
  RETURNING ${job}, now() - j.run_at AS lag
`.select({
  job,
  lag: t.interval,
})
// claimed: { job: { id: number; runAt: string }; lag: string }[]
```

The columns are a SQL fragment, `"j"."id" AS "j__id", "j"."run_at" AS "j__runAt"`, and a field of `select` that reads the record from these result columns.
The fragment names each result column by the key of its column after the `prefix` option, which is the alias by default; the names of the result columns of several tables of one statement must differ.
`createSqlColumns` applies the read expression of the type of each column that has one.
For a statement that you build as text, insert `job.text` instead.

To name the type of the record, pass the columns to `RecordOf`; for the columns of `nullable()`, it includes `null`:

```ts
import type { RecordOf } from "kern-db/builder"

type ClaimedJob = RecordOf<typeof job>
// ClaimedJob: { id: number; runAt: string }
```

`key` lists the columns that are never `NULL` in a row, such as a primary key: `job.nullable()` then makes the record `null` when they are all `NULL`, such as without a match of a `LEFT JOIN`.
The record has the keys and the types of the columns that you write in the call, and the `key` option tells whether the columns have their key.
A column that the list does not guarantee, such as one of a union of columns or of a spread array, is optional in the record; a column of one known key written before or after a spread is required.
Type the key of a column as a string literal, a union of them, `string`, or a template literal type: the record does not tell the columns of a key of another type, such as a branded `string` or a member of a string enum.
`createSqlColumns` rejects a column of `key` that the columns do not include when it creates them, so `nullable()` without `by` is safe for columns that have their key.
For columns that your builder collects at runtime, such as an array of `SqlColumn`, the types do not tell the keys of the record, so declare the record in your own function by the type of your table, as kern-orm does for `columnsOf`.
Here a table carries the type of its row in a member that only types have, and every table has a primary key:

```ts
import type { SqlColumn, SqlColumns } from "kern-db/builder"

declare const rowType: unique symbol

interface MyTable<Row> {
  columns: SqlColumn[]
  primaryKey: readonly [string, ...string[]]
  /** Type of a row of the table, for types only. */
  readonly [rowType]: Row
}

function columnsOfTable<Row>(table: MyTable<Row>, alias: string) {
  return createSqlColumns(table.columns, { alias, key: table.primaryKey }) as SqlColumns<Row, true>
}
```

`createSqlColumns` rejects a name of a result column that may take more than 63 bytes in the encoding of a server, since PostgreSQL truncates a longer name: it counts a character other than ASCII as 4 bytes, the most that a server encoding takes.
To keep a name that your builder generates within a number of bytes counted the same way, cut it with `cutIdentifier(name, maxBytes)`; `maxIdentifierBytes` is the 63 bytes of PostgreSQL.

## Results of your own

When your builder returns results that a query of SQL text does not decode, such as related records nested as JSON, execute the statement with `database.execute` and decode its rows yourself.
It runs the statement in the current transaction and returns its rows as the PostgreSQL text representations of their values, with `null` for `NULL`; decode a value with `decode` of its type, and `NULL` with `decodeNull` of `kern-db/builder`, which gives `null` or the value that a type of [`nullableAs`](./types#nullable-values) reads `NULL` as.

For a builder with its own codecs, `columns` of the result gives the `name` and PostgreSQL type OID (`type`) of each column, in the same order as the values in each row.
The metadata is available even when the query returns no rows:

```ts
const result = await database.execute({
  text: "SELECT 42::integer AS id, '42'::text AS label WHERE false",
  parameters: [],
})
// result.columns: [{ name: "id", type: 23 }, { name: "label", type: 25 }]
// result.rows: []
```

Use each OID to select the codec for that result column; values remain text or `null` regardless of the OID.
An array column reports the OID of its array type, not of its element type.
For types defined by the application, resolve the OID against `pg_catalog.pg_type` in the same database; it is not a portable identifier across databases.
These are the result types reported by PostgreSQL, not a description of the source table's columns or the custom parsers of another client.

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
  record[key] = text === null ? decodeNull(type) : type.decode(text)
} catch (error) {
  throw createFieldDecodeError(`[${index}].${key}`, error)
}
```

When your users choose the keys of the records, reject a key for which `isRecordKey` returns `false`, such as `__proto__`: assigning it would change the prototype of the record instead of adding a field.

## Values that postgres.js serializes

A builder whose statements take JavaScript values that postgres.js serializes, rather than PostgreSQL text, can run them on the postgres.js driver.
Put the values in a field that your builder adds to the statement, and return them from the `getNativeParameters` option of `postgresJsDriver`:

```ts
import type { SqlStatement } from "kern-db"
import { createDatabase } from "kern-db"
import { postgresJsDriver } from "kern-db/postgres-js"
import postgres from "postgres"

const values = Symbol("values")

interface NativeStatement extends SqlStatement {
  readonly [values]?: readonly unknown[]
}

export const database = createDatabase({
  driver: postgresJsDriver(postgres(process.env.DATABASE_URL!), {
    getNativeParameters: (statement: NativeStatement) => statement[values],
  }),
})

const statement: NativeStatement = {
  text: "SELECT $1::jsonb ->> 'name'",
  parameters: [],
  [values]: [{ name: "Kern" }],
}
const { rows } = await database.execute(statement)
// rows: [["Kern"]]
```

postgres.js serializes each value with the serializers of the client, by the type that PostgreSQL resolves for its parameter, as for a query of the client itself.
`database.execute` passes the statement to the driver as it is, so the values run in the current transaction like any other statement.
A statement for which the option returns `undefined`, such as of a query of SQL text, sends its text `parameters`.
A connection of `postgresJsConnection` sends the text `parameters` of every statement, so in a [transaction of another library](./interop#transactions-of-another-library), PostgreSQL rejects a statement whose values are only in such a field for its missing parameters.
A value that postgres.js fails to serialize rejects with `ConnectionError`, so a transaction rolls back even if its callback catches it.

## Depending on kern-db

Require `kern-db` in `peerDependencies` of your package, by a range of one minor line, such as `^0.1.0`:

- Your builder recognizes only the fragments, types, and queries of its own copy of kern-db, so it works only with the copy that the application uses; a peer dependency shares that copy when the version of kern-db of the application is in your range.
- Before 1.0, a minor version of kern-db may change `kern-db/builder`.

In a package that depends on kern-orm, import from `kern-orm/db/builder` instead, without requiring `kern-db` itself: it is the copy of kern-db that the queries of kern-orm use.
