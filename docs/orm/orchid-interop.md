# Orchid ORM Interop

To move an application from Orchid ORM to kern-orm one function at a time, connect both with `@kern-orm/orchid-interop`.
The existing Orchid queries and the new kern-orm queries then run on one connection pool, in the same transactions.

::: warning Experimental
The adapter supports Orchid ORM 1.x (1.78.61 or later) and postgres.js 4, and not every feature of Orchid ORM.
Check the [limitations](#limitations) against your application before you connect it.
:::

## Install

Install the adapter beside `kern-orm` and the supported versions of Orchid ORM and postgres.js:

```sh
npm install @kern-orm/orchid-interop kern-orm orchid-orm postgres@4
```

Set `skipLibCheck: true` in `tsconfig.json`: the declarations of Orchid ORM fail to type-check without it.
TypeScript still checks the code of your application.

## Create the database

Replace the call of `orchidORM` with `createOrchidInterop`, pass it the same tables, and bind your kern-orm schema to the `database` it returns:

```ts [src/db.ts]
import { bindSchema } from "kern-orm"
import { createOrchidInterop } from "@kern-orm/orchid-interop"

import { UserTable } from "./legacy/user.table"
import { schema } from "./schema"

export const { database, orchid } = await createOrchidInterop(
  {
    connection: { databaseURL: process.env.DATABASE_URL! },
    orchid: { log: true },
  },
  { user: UserTable },
)
export const db = bindSchema(schema, database)
```

Import `db` in new and converted code, and `orchid` in the rest.

Pass the connection options of postgres.js, such as `databaseURL` and `max`, in `connection`, and the other options of `orchidORM`, such as `log` and `schema`, in `orchid`.
`createOrchidInterop` connects to the database to load its types, so it returns a promise; await it in the module, as above, which requires ES modules.

`database` and `orchid` share one connection pool; close either of them when the application stops.

## Share transactions

Start a transaction with either ORM, and the queries of both run in it:

```ts
await db.$transaction(async () => {
  const user = await orchid.user.create({ email })
  await db.profile.insert({ userId: user.id, name })
})

await orchid.$transaction(async () => {
  await db.profile.where({ userId }).delete()
  await orchid.user.find(userId).delete()
})
```

The transaction rolls back the changes of both ORMs when the callback rejects.
A transaction started inside another, with either ORM, is a [nested transaction](./transactions#nested-transactions).
`$ensureTransaction` and `$isInTransaction` of Orchid see the transactions of kern-orm, as those of kern-orm see the transactions of Orchid.

Pass `READ COMMITTED`, `REPEATABLE READ`, or `SERIALIZABLE` to `orchid.$transaction` to set the isolation level.
When you pass a level, do not change it in the transaction from SQL text, such as with `SET TRANSACTION`: a nested transaction is checked against the level that you passed.

Recover from a failed Orchid query in a transaction with `.catch()`, `.catchUniqueError()`, or `.recoverable()`, as before: such a query runs in a nested transaction, so a failure that PostgreSQL reports, such as of a unique constraint, rolls back only its own changes, and the transaction continues.
A write of `.none()` [rolls back only its statement](#limitations).
A [`ConnectionError`](./errors), such as of a value that postgres.js fails to serialize, still rolls back the whole transaction.

## Test

Pass `database: { test: true }` to `createOrchidInterop` in tests, and create the [test helpers](./testing) of kern-orm with the `database` it returns:

```ts
export const { database, orchid } = await createOrchidInterop(
  {
    connection: { databaseURL: process.env.DATABASE_URL! },
    database: { test: process.env.NODE_ENV === "test" },
  },
  { user: UserTable },
)
```

A test transaction of kern-orm covers the queries of both ORMs.
Outside a transaction of the tested code, `$isInTransaction()` returns `false`, as in production.
Orchid still starts its automatic transactions, such as for a create with an `afterCreate` hook or with nested creates.
Replace the `testTransaction` of Orchid in your tests with the test helpers of kern-orm: the adapter does not support it.

## Values and errors

Orchid queries return the same values as before, such as timestamps as strings, and kern-orm queries return the values of their [types](./types).

When PostgreSQL rejects a query of an Orchid table, it rejects with the `QueryError` of Orchid, with its `code`, `constraint`, and other fields, as before.
When PostgreSQL rejects a query of SQL text, such as `orchid.$query`, it rejects with the [`QueryError` of kern-orm](./errors) instead of the error of postgres.js.
Errors of the connection and of the lifetime of a transaction are the [errors of kern-orm](./errors).

## Limitations

- After-commit hooks of Orchid are not supported: `$afterCommit`, and `afterCreateCommit`, `afterUpdateCommit`, `afterDeleteCommit`, and `afterSaveCommit` of tables and queries.
  `createOrchidInterop` rejects a table that declares one.
- The isolation level `READ UNCOMMITTED`, the transaction options `readOnly` and `deferrable`, and the `role` and `setConfig` options of Orchid are not supported.
  The postgres.js options in `connection` set the initial value of a setting on every connection of the pool, such as `connection: { connection: { statement_timeout: 5000 } }`, and `user` sets the role that the pool logs in with.
  The adapter has no equivalent of the `role` and `setConfig` options of Orchid for one transaction or one callback of `$withOptions`, such as for the role of the current tenant.
- The connection options `schema`, `setConfig`, `connectRetry`, and `types`, and the transforms of results in `transform`, such as `postgres.camel`, are not supported.
- A recoverable write of `.none()`, such as `.none().orCreate(data).recoverable()`, rolls back only a failure of its statement, as in Orchid: when its `transform` throws, the created row stays.
  Such a write that selects relations rejects.
  To roll back such a write as a whole, run it without recovery in a `db.$transaction()` of its own and catch the error outside that call.
- Queries run without prepared statements, as the queries of kern-orm do: the `autoPreparedStatements` option of Orchid has no effect.
- Orchid's `testTransaction` is not supported.
- Queries of `orchid` with values do not run in a [transaction of another library](./interop#transactions-of-another-library) on a connection of `postgresJsConnection`, which sends only the text parameters of kern-orm: PostgreSQL rejects such a query for its missing parameters.
- A query of SQL text, such as `orchid.$query`, runs one statement.
  Run a script of several statements with `database.script()`.
- The adapter rejects direct transaction and savepoint commands in a query of SQL text, such as `BEGIN`, `COMMIT`, and `ROLLBACK TO SAVEPOINT`: start transactions with `orchid.$transaction` or `db.$transaction`.
  In a transaction, PostgreSQL also keeps procedures and `DO` blocks from committing or rolling it back.
- A result column of an array of a type created in the database after `createOrchidInterop`, such as of an enum that a migration creates while the application runs, comes to Orchid queries as its text; the `orchid` of a new `createOrchidInterop` reads it as an array.
  `fetch_types: false` in `connection` turns off the loading of these types, so a result column of an array of any type defined in the database comes as its text.
