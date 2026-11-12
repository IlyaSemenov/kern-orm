# Reusable Queries

To reuse a query in several places, build it from `db` and await it wherever you need its result:

```ts
export const publishedForms = db.form.where({ published: true }).select("id", "name")

const forms = await publishedForms
```

Each `await` executes the query again.

`ResultOf` gives the type of each of its records, or of its values with [`pluck`](./selecting#values) and [`get`](./selecting#one-value):

```ts
import type { ResultOf } from "kern-orm"

type PublishedForm = ResultOf<typeof publishedForms>
```

Of a [helper](./composing#helpers), `ResultOf` gives the type of the records that it selects.

For reusable conditions and other expressions, see [`defineExpression`](./expressions#reusable-expressions), and for reusable clauses, [helpers](./composing#helpers).

## Queries without a Db

When your application gets its database from dependency injection, bind `db` to a function that returns the database, as [Database of the current context](../schemas#database-of-the-current-context) describes, and build reusable queries from `db` as above: each runs on the database of the context where it is awaited.

To define a query in code that has no `Db`, such as code [shared by several Dbs](../multiple-schemas#shared-code), start it from the schema, such as `schema.form`, and execute it with `$execute` of the `Db` that runs it:

```ts
export const publishedForms = schema.form.where({ published: true }).select("id", "name")

const forms = await db.$execute(publishedForms)
```

Queries that [change records](./mutations) work the same way, such as `db.$execute(schema.form.find(formId).delete())`.
Any `Db` whose schema contains the tables of such a query and the relations it selects can execute it, such as the [tenant and SaaS](../multiple-schemas) databases.
Start [other nested queries](./relations#other-queries) from the schema too, such as `schema.field`, and [several queries at once](./selecting#several-queries-at-once) with `schema.$select`.

Such a query is not bound to a database, so it can also be returned from async functions without executing.
