# Selecting

## Fields

List the columns you need in `select`:

```ts
const forms = await db.form.select("id", "name")
```

A record has no fields without `select`, so a result never carries data that the code did not ask for.

To select all columns of the table, call `select("*")`.

To rename columns or select results of operators and `sql` fragments, pass a callback that returns them under keys of your choice:

```ts
import { sql } from "kern-orm"
import * as t from "kern-orm/types"

const forms = await db.form.select(form => ({
  id: form.id,
  title: form.name,
  isDraft: form.name.ilike("draft%"),
  upper: sql(t.text)`upper(${form.name})`,
}))
// forms: { id: string; title: string; isDraft: boolean; upper: string }[]
```

A field keeps the type of its expression, so a column or a fragment of `sql(type)` returns values of its type.
A selected fragment needs a type, such as `sql(t.bigint)` for `count(*)`.

Each `select` adds new fields to those selected before:

```ts
const forms = await db.form.select("id").select(form => ({
  title: form.name,
}))
// forms: { id: string; title: string }[]
```

Selecting an existing key replaces its expression and type; the last selection wins:

```ts
const forms = await db.form.select("id", "name").select(form => ({
  name: sql(t.integer)`length(${form.name})`,
}))
// forms: { id: string; name: number }[]
```

`select("*")` also replaces fields under column keys and keeps the other fields.

`clearSelect` removes all selected fields and keeps the other clauses:

```ts
const publishedForms = db.form.where({ published: true }).select("id", "name")

const names = await publishedForms.clearSelect().select("name")
// names: { name: string }[]
```

The keys of selected fields name only the fields of records: `where` keeps filtering by the columns of the table.

To select the related records of each row, such as the fields of each form, see [Related Records](./relations).

## One row

To get one row instead of an array, call `take`:

```ts
const form = await db.form.where({ name: "Survey" }).select("id", "published").take()
// form: { id: string; published: boolean }
```

`take` can come before `select`: `take().select("id")` also returns one record.
Call [`limit` and `offset`](./sorting#pagination) before `take`.

Without a row, `take` rejects with `NotFoundError`; when the row may be missing, add `optional` to get `undefined` instead:

```ts
const form = await db.form.where({ name: "Survey" }).select("id").take().optional()
// form: { id: string } | undefined
```

To get `null` instead, add `nullable`:

```ts
const form = await db.form.where({ name: "Survey" }).select("id").take().nullable()
// form: { id: string } | null
```

`required` makes such a query reject without a row again.

## Values

To get the values of a column or an expression instead of records, call `pluck`; it replaces the selected fields:

```ts
const names = await db.form.where({ published: true }).pluck("name")
// names: string[]

const draftFlags = await db.form.pluck(form => form.name.ilike("draft%"))
// draftFlags: boolean[]
```

## One value

To get one value, such as the name of a form, call `get` with a column or an expression:

```ts
const name = await db.form.where({ id }).get("name")
// name: string

const isDraft = await db.form.where({ id }).get(form => form.name.ilike("draft%"))
// isDraft: boolean
```

`get("name")` is a shorthand for `pluck("name").take()`.

Without a row, `get` rejects with `NotFoundError`; when the row may be missing, add `optional` to get `undefined` instead:

```ts
const name = await db.form.where({ id }).get("name").optional()
// name: string | undefined
```

A `NULL` value is `null`, so it differs from a missing row.
