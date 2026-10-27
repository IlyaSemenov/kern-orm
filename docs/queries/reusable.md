# Reusable Queries

To reuse a query in several places, build it from `db` and await it wherever you need its result:

```ts
export const publishedForms = db.form.where({ published: true }).select("id", "name")

const forms = await publishedForms
```

Each `await` executes the query again.

`ResultOf` gives the type of its records, or of its values with [`pluck`](./selecting#values) and [`get`](./selecting#one-value):

```ts
import type { ResultOf } from "kern-orm"

type PublishedForm = ResultOf<typeof publishedForms>
```

For reusable conditions, see [`defineFilter`](./filtering#reusable-filters), and for reusable clauses, [helpers](./composing#helpers).

## Queries without a Db

To define a query before a `Db` is available, start it from the schema, such as `schema.form`.
Execute it with `$execute` when you get the `Db`, such as through dependency injection:

```ts
export const publishedForms = schema.form.where({ published: true }).select("id", "name")

const db = useDb()
const forms = await db.$execute(publishedForms)
```

Any `Db` whose schema contains the tables of such a query and the relations it selects can execute it, such as the [tenant and SaaS](../multiple-schemas) databases.
Start [other nested queries](./relations#other-queries) from the schema too, such as `schema.field`.

Such a query is not bound to a database, so it can also be returned from async functions without executing.
