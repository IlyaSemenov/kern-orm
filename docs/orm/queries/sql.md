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
  INSERT INTO ${db.form} (id, name, published) VALUES (${formId}, ${name}, ${false})
  ON CONFLICT (id) DO UPDATE SET name = excluded.name
  RETURNING id, name, (xmax = 0) AS inserted
`.select({
  id: t.uuid,
  name: t.text,
  inserted: t.boolean,
})
// forms: { id: string; name: string; inserted: boolean }[]
```

Here, `select` reads each field from the column of its name, whatever their order.
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

## Rows of tables

To get the rows of a table from a statement without listing its columns in the SQL and again in `select`, take the columns of the table with `columnsOf`, interpolate them into the statement, and pass them to `select` as a field:

```ts
import { columnsOf } from "kern-orm"

const form = columnsOf(db.form, "*")

const upserted = await db.$query`
  INSERT INTO ${db.form} (id, name, published) VALUES (${formId}, ${name}, ${false})
  ON CONFLICT (id) DO UPDATE SET name = excluded.name
  RETURNING ${form}, (xmax = 0) AS inserted
`.select({
  form,
  inserted: t.boolean,
})
// upserted: { form: { id: string; name: string; published: boolean }; inserted: boolean }[]
```

The field `form` is the record of the row, with the keys and the types of the columns that `columnsOf` takes, as a query of the table returns it.
`select` reads it from the result columns that `columnsOf` names in the statement, such as `id`, not from a column named `form`.
`columnsOf` applies the [read expression](../custom-types#reading-values-by-an-expression) of the type of each column that has one.

As with [`select`](./selecting#fields), name the columns explicitly: `"*"` takes all the columns of the table, and a list of keys, such as `columnsOf(db.form, ["id", "name"])`, takes those columns in its order.
As in `select` by keys, a column whose key is chosen at runtime is optional in the record unless the list also names it explicitly.

To name the type of the record, pass the columns to `RecordOf`; for the columns of `nullable`, it includes `null`:

```ts
import type { RecordOf } from "kern-orm"

type FormRecord = RecordOf<typeof form>
// FormRecord: { id: string; name: string; published: boolean }
```

When the statement gives the table an alias, pass it as `alias`; it is also the prefix of the names of the result columns by default, which must differ for several tables of one statement:

```ts
const form = columnsOf(db.form, "*", { alias: "f" })
const firstField = columnsOf(db.field, "*", { alias: "d" }).nullable()

const forms = await db.$query`
  SELECT ${form}, ${firstField}
  FROM ${db.form} f
  LEFT JOIN ${db.field} d ON d.form_id = f.id AND d.position = 1
`.select({
  form,
  firstField,
})
// forms: { form: { id: string; ... }; firstField: { id: string; ... } | null }[]
```

The result columns of each table are named by its alias, such as `f__id`, or by the `prefix` option when you pass it, and by the keys of the columns alone without both.

`nullable` makes the record `null` when the statement has no row of the table, such as without a match of a `LEFT JOIN`.
It tells such a row by the columns in its `by` option, which must never be `NULL` in a row, or by the whole primary key of the table without the option.
For a view, or for columns without the primary key, pass `by`: `columnsOf(db.formStats, "*").nullable({ by: ["formId"] })`.

## Comments

To find the statement in PostgreSQL, label it with `comment`, as you [label a query](./#comments):

```ts
const total = await db.$query`SELECT count(*) FROM ${db.form}`.comment("forms:count").get(t.integer)
// SQL: /* forms:count */ SELECT count(*) FROM "form"
```

A later `comment` replaces the label, and `comment(null)` removes it.

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

A query of one value, such as of [`count`](./aggregates#aggregates), becomes its value, as in a [condition](./filtering#values-of-other-queries).
Start the query from the same `Db` as the statement.

## Lists

To build a list whose length is known only at runtime, such as the rows of a multi-row `VALUES`, pass its items to `joinSql`, which joins them with commas:

```ts
import { joinSql, sql } from "kern-orm"

await db.$query`
  INSERT INTO ${db.form} (id, name)
  VALUES ${joinSql(forms.map(form => sql`(${form.id}, ${form.name})`))}
`
```

An item is anything that you interpolate into `sql`, such as a fragment, an expression, or a value, which becomes a parameter.
To join with another separator, pass it as a fragment, such as ``joinSql(conditions, sql` AND `)``.

When there are no rows to insert, skip the statement: `joinSql` throws for an empty array, since PostgreSQL rejects an empty list in most places, such as `VALUES` and `IN`.

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

## Values in statements without parameters

PostgreSQL takes a parameter for a value of a query, such as `SELECT`, `INSERT`, or `UPDATE`, and rejects one in statements such as `ALTER`, `COMMENT`, and `SET`.
To write a value into such a statement, such as the default of a column into `ALTER TABLE`, interpolate `literal` of `kern-orm/db` with it:

```ts
import { literal } from "kern-orm/db"

await db.$query`ALTER TABLE ${db.form} ALTER COLUMN name SET DEFAULT ${literal(defaultName)}`
// SQL: ALTER TABLE "form" ALTER COLUMN name SET DEFAULT 'Untitled'
```

`literal` writes the value into the SQL as a literal, so add no quotes around it.
To interpolate SQL that your code computes as a string, such as a type with its modifiers, pass it to `unsafeSql` of `kern-orm/db`, and never pass it input of a user.
See [SQL Queries and Scripts](../../database/sql#values-in-statements-without-parameters) for the values that `literal` takes and where it is safe.

## Scripts

To run several statements at once, such as the SQL of a migration file, pass them to `db.$script`:

```ts
import { readFile } from "node:fs/promises"

await db.$script(await readFile("migrations/001-forms.sql", "utf8"))
```

A script has no parameters, so its template interpolates only tables of `db`, queries without parameters, and fragments without parameters, such as names from `identifier` and values from [`literal`](#values-in-statements-without-parameters):

```ts
await db.$script`
  CREATE INDEX form_name ON ${db.form} (name);
  ANALYZE ${db.form};
`
```

The script runs in the current transaction; outside one, PostgreSQL applies all its statements or none.
Leave transactions to kern-orm: do not write `BEGIN`, `COMMIT`, or `ROLLBACK` in a script.

In code that has the database but no `Db`, run statements with `database.query` and scripts with `database.script`; see [SQL Queries and Scripts](../../database/sql).

## Statements on a connection or a driver

To run a statement on a driver, a connection that your code holds, or an object that wraps one, write it with `queryOn` of `kern-orm/db`:

```ts
import { columnsOf } from "kern-orm"
import type { StatementExecutor } from "kern-orm/db"
import { queryOn } from "kern-orm/db"

const job = columnsOf(db.job, ["id", "task"], { alias: "j" })

function claimJobs(executor: StatementExecutor, worker: string) {
  return queryOn(executor)`
    UPDATE job j SET locked_by = ${worker}
    WHERE j.locked_by IS NULL
    RETURNING ${job}
  `.select({
    job,
  })
}

const claimed = await claimJobs(connection, "worker-1")
// claimed: { job: { id: number; task: string } }[]
```

Its template interpolates values, the columns of `columnsOf`, and the `sql`, `joinSql`, `identifier`, `literal`, `unsafeSql`, and `param` fragments of `kern-orm/db`.
It takes no table or query of a `Db`, so name tables in the SQL, or by `identifier` with their PostgreSQL schema.
To keep the template in a field or take it as a parameter, type it as `SqlQueryTemplate` of `kern-orm/db`.

For how such a statement relates to transactions and to the rollback of tests, see [SQL Queries and Scripts](../../database/sql#statements-on-a-connection-or-a-driver).
