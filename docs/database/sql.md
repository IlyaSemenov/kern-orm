# SQL Queries and Scripts

Write a statement with the `database.query` template and await it:

```ts
const updatedCount = await database.query`UPDATE form SET published = true WHERE id = ${formId}`
// updatedCount: number
```

It resolves to the number of rows that PostgreSQL reports for the statement, such as the updated rows.
To require exactly one such row, such as when updating a record by its key, add `take`: it rejects with `NotFoundError` without the row, unless you add `optional`.

Interpolated values become query parameters, and [`sql` fragments](#sql-fragments) stay SQL.
The statement runs in the current [transaction](./transactions).

## Rows

To get the rows that the statement returns, pass the types of their columns from `kern-db/types` to `select`:

```ts
import * as t from "kern-db/types"

const forms = await database.query`SELECT id, name, published FROM form ORDER BY name`.select({
  id: t.uuid,
  name: t.text,
  published: t.boolean,
})
// forms: { id: string; name: string; published: boolean }[]
```

`select` reads each field from the column of its name, whatever their order.
Give a column that can be `NULL` a [nullable type](./types#nullable-values), such as `t.text.nullable()`.

To get one row, add `take`: it rejects with `NotFoundError` without the row, unless you add `optional`, which gives `undefined` then, or `nullable`, which gives `null`.
`take` adds no `LIMIT` to the statement, so it rejects several rows.

kern-db checks the rows after the statement runs, so a statement that rejects in `take` or while decoding its rows has already made its change.
To undo the change with the error, run the statement in a [transaction](./transactions).

To get the values of a single column, pass its type to `pluck`, or to `get` for one value:

```ts
const total = await database.query`SELECT count(*) FROM form`.get(t.integer)
// total: number
```

## SQL fragments

To build a part of a statement separately, such as the condition of an optional filter, write it with the `sql` template and interpolate it into the statement:

```ts
import { sql } from "kern-db"

const filter = published === undefined ? sql`true` : sql`published = ${published}`

const forms = await database.query`SELECT id, name FROM form WHERE ${filter}`.select({
  id: t.uuid,
  name: t.text,
})
```

A fragment stays SQL, and the values interpolated into it become parameters of the statement.
Interpolate a fragment into as many statements and other fragments as you need.

## Names known at runtime

To name a table, a column, or another object known only at runtime, such as in a loop over tables, interpolate `identifier` with its name:

```ts
import { identifier } from "kern-db"

await database.query`UPDATE form SET ${identifier(column)} = ${value}`
```

`identifier` does not add a PostgreSQL schema to the name.
To name an object in a schema, pass the schema before the name:

```ts
await database.query`ANALYZE ${identifier(schemaName, tableName)}`
```

## JSON and arrays

To pass JSON or an array, interpolate `param` with its type:

```ts
import { param } from "kern-db"
import * as t from "kern-db/types"

await database.query`UPDATE form SET tags = ${param(t.array(t.text), tags)} WHERE id = ${formId}`
```

## Scripts

To run several statements at once, such as the SQL of a migration file, pass them to `database.script`:

```ts
import { readFile } from "node:fs/promises"

await database.script(await readFile("migrations/001-forms.sql", "utf8"))
```

A script has no parameters, so interpolate only names from `identifier` and `sql` fragments without values into its template:

```ts
await database.script`ANALYZE ${identifier(schemaName, tableName)}`
```

The script runs in the current transaction; outside one, PostgreSQL applies all its statements or none.
Leave transactions to kern-db: do not write `BEGIN`, `COMMIT`, or `ROLLBACK` in a script.
