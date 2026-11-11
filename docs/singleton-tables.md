# Singleton Tables

To keep a record that an application has at most one of, such as its license or its settings, in a table of one row, declare the table with `singleton: true`:

```ts
import { defineTable } from "kern-orm"
import * as t from "kern-orm/types"

export const license = defineTable(
  "license",
  {
    id: t.uuid.primaryKey().hasDefault(),
    token: t.text,
    expiresAt: t.timestamptz.nullable().columnName("expires_at"),
  },
  { singleton: true },
)
```

A query of the table, such as `db.license`, is a query of its row, so you read and save the row without a key or a filter.
[Create a unique index](#the-table-in-a-migration) of the table that keeps it to one row.

## Reading the row

Read the row from the query of the table; without the row, it resolves to `undefined`:

```ts
const license = await db.license.select("token", "expiresAt")
// license: { token: string; expiresAt: Date | null } | undefined

const token = await db.license.get("token")
// token: string | undefined
```

When the row must exist, add `required` to reject with `NotFoundError` without it:

```ts
const { token } = await db.license.required().select("token")
```

To get `null` instead of `undefined` without the row, add `nullable`, as for [one row](./queries/selecting#one-row) of another table.

To tell whether the row exists, call `exists`:

```ts
const installed = await db.license.exists()
```

## Saving the row

To save the row whether it exists or not, pass its values to `upsert`:

```ts
await db.license.upsert({ token, expiresAt })
```

`upsert` inserts the row with the values, or sets the values of the existing row, in one statement, so that a concurrent request that inserts the row does not make it fail on a duplicate key.
Pass the values that [`insert`](./queries/mutations#inserting) takes, since a missing row is inserted.
A column that you omit, or give as `undefined`, gets its default in a new row and keeps its value in an existing one.
`upsert` takes at least one value other than `undefined`.

Call `upsert` on the query of the table without other methods, such as `where`, and select the fields of the row after it:

```ts
const licenseId = await db.license.upsert({ token }).get("id")
// licenseId: string
```

`insert` inserts the row and fails on a duplicate key when the row exists.
To insert the row only when it is missing, call `onConflict()` and `doNothing` after it; to set other values on the existing row than on a new one, call `update` after `onConflict()`, as for [records that already exist](./queries/mutations#records-that-already-exist) of another table:

```ts
await db.license.insert({ token }).onConflict().doNothing()
```

## Updating and deleting the row

To update or delete the row, call `update` or `delete` on the query of the table, without `all`:

```ts
await db.license.update({ expiresAt })

await db.license.delete()
```

Without the row, they resolve to `0`, and the fields that you select after them to `undefined`.
Add `required` before them to reject with `NotFoundError` instead:

```ts
const licenseId = await db.license.required().update({ expiresAt }).get("id")
// licenseId: string
```

## The table in a migration

Create a unique index of `(true)` of the table in its migration, so that the database rejects a second row; `upsert` finds the existing row by it too:

```ts
import { createIndex, createTable, defineMigration } from "kern-migrations"

export default defineMigration([
  createTable("license", {
    id: "uuid PRIMARY KEY DEFAULT gen_random_uuid()",
    token: "text NOT NULL",
    expires_at: "timestamptz",
  }),
  createIndex("license", ["(true)"], { unique: true, name: "license_singleton_idx" }),
])
```

The index stores `true` for every row, so a second row has a duplicate key.
Any unique index of `(true)` serves, whatever its name; kern-orm does not check that the database has one.
