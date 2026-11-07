# Composing Queries

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

A helper can also return one row with `take`, optionally followed by `optional`, `nullable`, or `required`, [sort and paginate](./sorting) the rows, [remove their duplicates](./selecting#distinct-rows), [keep the first row of each group](./selecting#first-row-of-each-group), [group them](./grouping), and [lock them](../transactions#locking-rows).
Apply a helper that calls `limit`, `offset`, `distinct`, or `distinctOn` before `take` and `get`, and one that calls `limit` or `offset` also before aggregates, such as `count`, and `exists`.
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

When the code that defines a helper has no `Db`, such as with dependency injection or in code [shared by several Dbs](../multiple-schemas#shared-code), define it with a table of the schema, such as `schema.form`.
Pass the table returned by `defineTable`, such as `form`, when the helper does not need the relations of the table.

For a reusable condition or value, use [`defineExpression`](./expressions#reusable-expressions).
