# SQL Statements

To run SQL that queries do not cover, write the statement with the `db.$query` template and await it:

```ts
const updatedCount = await db.$query`
  UPDATE ${db.form} SET published = true
  WHERE id IN (SELECT form_id FROM ${db.field} GROUP BY form_id HAVING count(*) >= ${3})
`
// updatedCount: number
```

It resolves to the number of rows that PostgreSQL reports for the statement, such as the updated rows.
To require exactly one such row, such as when updating a record by its key, add `take`: it rejects with `NotFoundError` without the row, unless you add `optional`.

Interpolated values become query parameters, [`sql` fragments](./filtering#sql-fragments) stay SQL, a table of `db`, such as `db.form`, becomes its name in the PostgreSQL schema of `db`, and [another query](#queries-in-statements) becomes a subquery.
The statement runs in the current [transaction](../transactions), like any query.

## Rows

To get the rows that the statement returns, pass the types of their columns to `select`:

```ts
import * as t from "kern-orm/types"

const forms = await db.$query`
  INSERT INTO ${db.form} (id, name) VALUES (${formId}, ${name})
  ON CONFLICT (id) DO UPDATE SET name = excluded.name
  RETURNING id, name, (xmax = 0) AS inserted
`.select({
  id: t.uuid,
  name: t.text,
  inserted: t.boolean,
})
// forms: { id: string; name: string; inserted: boolean }[]
```

`select` reads each field from the column of its name, whatever their order.
Give a column that can be `NULL` a [nullable](../types#nullable-values) type.

To get one row, add `take`, and `optional` or `nullable` when the row may be missing, as for [one row](./selecting#one-row) of a query.
`take` adds no `LIMIT` to the statement, so it rejects several rows.

kern-orm checks the rows after the statement runs, so a statement that rejects in `take` or while decoding its rows has already made its change.
To undo the change with the error, run the statement in a [transaction](../transactions).

To get the values of a single column, pass its type to `pluck`, or to `get` for one value:

```ts
const total = await db.$query`SELECT count(*) FROM ${db.form}`.get(t.integer)
// total: number
```

## Queries in statements

To compute what queries cannot, such as the median number of fields of published forms, interpolate a query into the statement.
It becomes a subquery in parentheses; name its columns after its alias, in the order of the fields of the query, leaving out [literals](./selecting#values-from-code):

```ts
const median = await db.$query`
  SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY field_count)
  FROM ${db.form.where({ published: true }).select(form => ({
    fieldCount: form.fields.count(),
  }))} AS form (field_count)
`.get(t.doublePrecision.nullable())
// median: number | null
```

A query of one value, such as of [`count`](./selecting#aggregates), becomes its value, as in a [condition](./filtering#values-of-other-queries).
Start the query from the same `Db` as the statement.

## Names known at runtime

To name a column or another object known only at runtime, interpolate `identifier` with its name:

```ts
import { identifier } from "kern-orm"

await db.$query`UPDATE ${db.form} SET ${identifier(column)} = ${value}`
```

`identifier` does not add a PostgreSQL schema to the name.
To name an object in a schema, pass the schema before the name:

```ts
await db.$query`ANALYZE ${identifier(schemaName, tableName)}`
```

## Scripts

To run several statements at once, such as the SQL of a migration file, pass them to `db.$script`:

```ts
import { readFile } from "node:fs/promises"

await db.$script(await readFile("migrations/001-forms.sql", "utf8"))
```

A script has no parameters, so its template interpolates only tables of `db`, names from `identifier`, and queries and `sql` fragments without parameters:

```ts
await db.$script`
  CREATE INDEX form_name ON ${db.form} (name);
  ANALYZE ${db.form};
`
```

The script runs in the current transaction; outside one, PostgreSQL applies all its statements or none.
Leave transactions to kern-orm: do not write `BEGIN`, `COMMIT`, or `ROLLBACK` in a script.

## Without a Db

In code that has the database but no `Db`, such as a runner of migrations, run statements with `database.query` and scripts with `database.script`:

```ts
import * as t from "kern-orm/db/types"

await database.script(await readFile("migrations/001-forms.sql", "utf8"))
const total = await database.query`SELECT count(*) FROM form`.get(t.integer)
// total: number
```

`database.query` runs and returns rows as `$query` does; pass the types of `kern-orm/db/types` to its `select`, `get`, and `pluck`.

Their templates interpolate the SQL fragments of `kern-orm/db`, not the tables, expressions, and `sql` fragments of `kern-orm`: interpolate those with `$query` or `$script` of a `Db`.
To name an object known only at runtime there, interpolate `identifier` from `kern-orm/db`, which takes the names as [`identifier`](#names-known-at-runtime) of `kern-orm` does:

```ts
import { identifier } from "kern-orm/db"

await database.script`ANALYZE ${identifier(schemaName, tableName)}`
```

To pass JSON or an array, interpolate `param` from `kern-orm/db` with its type:

```ts
import { param } from "kern-orm/db"
import * as t from "kern-orm/db/types"

await database.query`UPDATE form SET tags = ${param(t.array(t.text), tags)} WHERE id = ${formId}`
```
