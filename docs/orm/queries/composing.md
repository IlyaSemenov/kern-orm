# Composing and Reusing Queries

## Conditional clauses

To add a clause only when a condition is met, pass a callback to `use` and return the query with or without the clause:

```ts
const forms = await db.form
  .use(form => (onlyPublished ? form.where({ published: true }) : form))
  .select("id", "name")
// forms: { id: string; name: string }[]
```

The callback returns the query it receives or one built from it.

Branches of the callback can return different rows or fields, and the result is then the result of either branch.
Call the methods that change the rows or fields, such as `select`, `take`, and `get`, before `use` or in each branch rather than after it:

```ts
const forms = await db.form.select("id", "name").use(form => (single ? form.take() : form))
// forms: { id: string; name: string } | { id: string; name: string }[]
```

To return the fields of an insert, an update, or a delete only when a condition is met, pass a callback to its `use` in the same way:

```ts
const result = await db.form
  .insert({ name: "Survey", published: false })
  .use(query => (returnFields ? query.select("id", "name") : query))
// result: number | { id: string; name: string }
```

## Helpers

To reuse clauses in queries of a table, define them once with `defineHelper` and apply them with `use`:

```ts
import { defineHelper } from "kern-orm"

const withName = defineHelper(db.form, form => form.where({ published: true }).select("name"))

const forms = await db.form.select("id").use(withName)
// forms: { id: string; name: string }[]
```

`use` passes the arguments that follow the helper to the further parameters of its callback:

```ts
const search = defineHelper(db.form, (query, pattern: string) =>
  query.where(form => form.name.ilike(pattern)),
)

const forms = await db.form.select("id", "name").use(search, "%survey%")
```

A helper is also a function of a query: `search(db.form, "%survey%")` is the same as `db.form.use(search, "%survey%")`.

A helper can also return one row with `take`, optionally followed by `optional`, `nullable`, or `required`, [sort and paginate](./sorting) the rows, [remove their duplicates](./selecting#distinct-rows), [keep the first row of each group](./selecting#first-row-of-each-group), [group them](./aggregates#grouping), and [lock them](../locks#locking-rows).
Apply a helper that calls `limit`, `offset`, `distinct`, or `distinctOn` before `take`, `get`, aggregates, such as `count`, and `exists`.
Apply a helper that calls `groupBy` before aggregates, `exists`, and `map`; a query with `groupBy` cannot lock rows.
To discard the entire selection, return values, an aggregate, or whether rows exist instead of records, or convert the whole result, call `clearSelect`, `get`, `pluck`, the aggregate, `exists`, or `transform` on the query rather than in a helper.

A helper can also select [related records](./relations#helpers).

A helper can also convert the fields that it selects with [`map`](./selecting#results-converted-in-code), and then choose the rows after it where you apply it:

```ts
const withSlug = defineHelper(db.form, form =>
  form.select("id", "name").map(row => ({ ...row, slug: slugify(row.name) })),
)

const forms = await db.form.use(withSlug).where({ published: true }).orderBy("name")
// forms: { id: string; name: string; slug: string }[]
```

To return the same result from an insert, an update, or a delete, apply the helper to it with `use`:

```ts
const form = await db.form.insert({ name: "Survey", published: false }).use(withSlug)
// form: { id: string; name: string; slug: string }
```

A helper for a mutation can call only `select` and `map`: a mutation has no `where`, `orderBy`, or `take`.

To name the type of the records that a helper selects, such as of the records that a function returns, pass the helper to `ResultOf`:

```ts
import type { ResultOf } from "kern-orm"

const selectSummary = defineHelper(db.form, form => form.select("id", "name"))

type FormSummary = ResultOf<typeof selectSummary>
// FormSummary: { id: string; name: string }
```

It gives one record, with only the fields that the helper selects, or what its `map` gives.

When the code that defines a helper has no `Db`, such as code [shared by several Dbs](../multiple-schemas#shared-code), define it with a table of the schema, such as `schema.form`.
Pass the table returned by `defineTable`, such as `form`, when the helper does not need the relations of the table.

## Reusable queries

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

For a reusable condition or value, use [`defineExpression`](./expressions#reusable-expressions).

## Queries without a Db

When your application gets its database from dependency injection, bind `db` to a function that returns the database, as [Database of the current context](../schemas#database-of-the-current-context) describes, and build reusable queries from `db` as above: each runs on the database of the context where it is awaited.

To define a query in code that has no `Db`, such as code [shared by several Dbs](../multiple-schemas#shared-code), start it from the schema, such as `schema.form`, and execute it with `$execute` of the `Db` that runs it:

```ts
export const publishedForms = schema.form.where({ published: true }).select("id", "name")

const forms = await db.$execute(publishedForms)
```

Queries that [change records](./mutations) work the same way, such as `db.$execute(schema.form.find(formId).delete())`.
Any `Db` whose schema contains the tables and [sequences](../sequences) of such a query and the relations it selects can execute it, such as the [tenant and SaaS](../multiple-schemas) databases.
Start [other nested queries](./relations#other-queries) from the schema too, such as `schema.field`, and [several queries at once](./selecting#several-queries-at-once) with `schema.$select`.

Such a query is not bound to a database, so it can also be returned from async functions without executing.
