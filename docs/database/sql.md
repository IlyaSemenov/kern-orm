# SQL Queries and Scripts

::: info Using the ORM?
See [SQL Statements of the ORM](../orm/queries/sql): this page describes kern-db without the ORM.
:::

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

Here, `select` reads each field from the column of its name, whatever their order.
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

## Types of values

PostgreSQL types each interpolated value by its place in the statement, such as by the column that it is compared with or assigned to, so most values need no type.
In a plain `SELECT ${value}`, a value without a type is `text`.
In other places that do not tell the type, such as `${value} IS NULL` or an argument of `jsonb_build_object`, PostgreSQL rejects the statement with an error such as `could not determine data type of parameter $1`.
Give such a value its type with `param`:

```ts
const forms = await database.query`
  SELECT id, name FROM form
  WHERE ${param(t.text.nullable(), search)} IS NULL OR name ILIKE ${search}
`.select({
  id: t.uuid,
  name: t.text,
})
```

`param` casts the value to the type and encodes it as the type does.
A cast written in the statement, such as `${search}::text`, also types a value that needs no encoding.

Each occurrence of a value in a statement is a parameter of its own, also in a fragment that the statement interpolates several times, so each is typed by its place.
To pass a value once and read it in several places, select it in a common table expression:

```ts
await database.query`
  WITH input AS (SELECT ${param(t.timestamptz, now)} AS now)
  UPDATE job SET locked_at = input.now, lease_until = input.now + interval '1 minute'
  FROM input
  WHERE job.run_at <= input.now
`
```

## Statements on a connection or a driver

To run a statement on something other than the database, such as a [driver](./drivers), a connection that your code holds, or an object that wraps one to time or record its statements, pass it to `queryOn` and write the statement as the template that it returns:

```ts
import type { StatementExecutor } from "kern-db"
import { queryOn } from "kern-db"

function countPendingJobs(executor: StatementExecutor) {
  return queryOn(executor)`SELECT count(*) FROM job WHERE state = ${"pending"}`.get(t.integer)
}

const connection = await driver.acquire()
try {
  const pending = await countPendingJobs(connection)
  // pending: number
} finally {
  await connection.release()
}
```

The template is that of `database.query`, with the same values, fragments, and results.
`queryOn` takes any object with the `execute` method of a connection, a `StatementExecutor`, and the statement runs when you await the query:

```ts
let sentAt = 0
const timed: StatementExecutor = {
  execute(statement) {
    sentAt = performance.now()
    return driver.execute(statement)
  },
}

const pending = await countPendingJobs(timed)
```

The statement runs where `execute` of the object runs it:

- A driver runs it on any connection of its pool.
- A connection runs it on itself, in the transaction that is open on it, if any.
- An object of your own runs it wherever its `execute` passes it: `timed` above passes it to the driver, so it runs on the pool.
- A database runs it in the current [transaction](./transactions) or [session](./sessions), as `database.query` does, so a function that takes a `StatementExecutor` serves all of them.

A statement is part of a transaction of a database only when it runs on the connection of that transaction, where the database runs its own statements.
What it writes on another connection, such as of the pool of a driver or one that your code acquired, stays when that transaction rolls back, such as the transaction of the [test helpers](./testing).

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
