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
A selected fragment needs a type, such as `t.text` of `upper` above.

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

## Record by key

To get a record by its primary key, pass the value of the key to `find`:

```ts
const form = await db.form.find(formId).select("name", "published")
// form: { name: string; published: boolean }
```

For a primary key of several columns, pass the value of each column in the order of the key, such as `db.membership.find(userId, groupId)`.

To get a record by a unique key, pass the values of its columns to `findBy`:

```ts
const user = await db.user.findBy({ email }).select("id")
// user: { id: string }
```

`find(formId)` filters like `where({ id: formId })` and returns one row like `take()`, and `findBy({ email })` works the same way.
Without the record, they reject with `NotFoundError` unless you add `optional` or `nullable`, as for [one row](#one-row).
Call them on any query, such as `form.fields.find(fieldId)` of a [relation](./relations), and pass them what `where` takes, such as a column of the parent row in [another nested query](./relations#other-queries).

## Values

To get the values of a column or an expression instead of records, call `pluck`; it replaces the selected fields:

```ts
const names = await db.form.where({ published: true }).pluck("name")
// names: string[]

const draftFlags = await db.form.pluck(form => form.name.ilike("draft%"))
// draftFlags: boolean[]
```

## One value

To get one value, such as the ID of a form, call `get` with a column or an expression:

```ts
const id = await db.form.where({ name: "Survey" }).get("id")
// id: string

const isDraft = await db.form.where({ name: "Survey" }).get(form => form.published.eq(false))
// isDraft: boolean
```

`get("id")` is a shorthand for `pluck("id").take()`.

Without a row, `get` rejects with `NotFoundError`; when the row may be missing, add `optional` to get `undefined` instead:

```ts
const id = await db.form.where({ name: "Survey" }).get("id").optional()
// id: string | undefined
```

A `NULL` value is `null`, so it differs from a missing row.

To get another value instead of `NULL`, pass it to `coalesce`:

```ts
const hint = await db.field.find(fieldId).get("hint").coalesce("")
// hint: string
```

`coalesce` replaces only `NULL`: without a row, the query still rejects or gives `undefined`.
After `pluck`, it replaces each `NULL` value.

## Aggregates

To count the rows of a query, such as the published forms, call `count`:

```ts
const publishedCount = await db.form.where({ published: true }).count()
// publishedCount: number
```

To compute another aggregate of a column or an expression over the rows of a query, such as the last position of the fields of a form, call its method with the column or a callback, as for [`get`](#one-value):

```ts
const lastPosition = await db.field.where({ formId }).max("position")
// lastPosition: number | null
```

- `count` of a column counts its values other than `NULL`, and `countDistinct` the distinct ones.
- `min` and `max` give the smallest and the largest value.
- `sum` and `avg` give the sum and the average.
- `every` and `some` tell whether all or any of the Boolean values are true.
- `stringAgg` joins the values with the delimiter that it takes after the column, in the order of the query, set by [`orderBy`](./sorting) before or after it.

To average a `bigint` column, pass it in a fragment of a type that can represent fractional values, such as ``avg(file => sql(t.doublePrecision)`${file.size}`)``, since its average can have a fractional part.

An aggregate skips `NULL` values and gives `null` without other values, while the counts give `0`.
To get another value instead, such as `0` for a form without fields, pass it to `coalesce`:

```ts
const lastPosition = await db.field.where({ formId }).max("position").coalesce(0)
// lastPosition: number
```

`coalesce` also takes an expression of the values of the aggregate, such as a column of the parent row of [related records](./relations#aggregates-of-related-records).

An aggregate keeps the filters of the query and ignores its selected fields.
With [`limit` and `offset`](./sorting#pagination), it aggregates the rows of the page, which the order of the query chooses.

## Whether rows exist

To check whether a query has rows, such as whether any form is published, call `exists`:

```ts
const hasPublished = await db.form.where({ published: true }).exists()
// hasPublished: boolean
```

`exists` keeps the filters of the query and ignores its selected fields; with [`limit` and `offset`](./sorting#pagination), it checks the rows of the page.

## Several queries at once

To load the results of independent queries in one round trip, such as the forms of a page and the number of users, pass the queries to `db.$select` under keys of your choice:

```ts
const page = await db.$select({
  forms: db.form.where({ published: true }).select("id", "name"),
  userCount: db.user.count(),
})
// page: { forms: { id: string; name: string }[]; userCount: number }
```

The queries run as one SQL statement, and each field gets the result that its query gives when awaited, such as an array of records or one value.
A field can also hold an expression, such as a fragment of `sql(type)`.

When a query of one row, such as one of `find`, finds no row, `$select` rejects with `NotFoundError`, whose `path` names its field; add `optional` to the query to get `undefined` in its field instead, or `nullable` to a query of records to get `null`.
