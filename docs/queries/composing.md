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
Call `select`, `get`, and `pluck` before `use` or in each branch rather than after it:

```ts
const forms = await db.form.select("id", "name").use(form => (single ? form.take() : form))
// forms: { id: string; name: string } | { id: string; name: string }[]
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

A helper can also return one row with `take`, optionally followed by `optional`, `nullable`, or `required`, and [sort and paginate](./sorting) the rows.
Apply a helper that calls `limit` or `offset` before `take` and `get`.
To discard the entire selection or return values instead of records, call `clearSelect`, `get`, or `pluck` on the query rather than in a helper.

A helper can also select [related records](./relations#helpers).

When the code that defines a helper has no `Db`, such as with dependency injection or in code [shared by several Dbs](../multiple-schemas#shared-code), define it with a table of the schema, such as `schema.form`.
Pass the table returned by `defineTable`, such as `form`, when the helper does not need the relations of the table.

For a reusable condition alone, use [`defineFilter`](./filtering#reusable-filters), which also combines with `and`, `or`, and `not`.
