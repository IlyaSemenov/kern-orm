# Aggregates and Grouping

## Aggregates

To count the rows of a query, such as the published forms, call `count`:

```ts
const publishedCount = await db.form.where({ published: true }).count()
// publishedCount: number
```

To compute another aggregate of a column or an expression over the rows of a query, such as the last position of the fields of a form, call its method with the column or a callback, as for [`get`](./selecting#one-value):

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

An aggregate skips `NULL` values and gives `NULL` without other values, which a query returns as `null`, or as the value that the type of the column [reads `NULL` as](../types#null-read-as-undefined), while the counts give `0`.
To get another value instead, such as `0` for a form without fields, pass it to `coalesce`:

```ts
const lastPosition = await db.field.where({ formId }).max("position").coalesce(0)
// lastPosition: number
```

`coalesce` also takes an expression of the values of the aggregate, such as a column of the parent row of [related records](./relations#aggregates-of-related-records), or a query of one such value.

An aggregate keeps the filters of the query and ignores its selected fields, apart from those that [`distinct`](./selecting#distinct-rows) compares.
With [`limit` and `offset`](./sorting#pagination), it aggregates the rows of the page, which the order of the query chooses.

### Several aggregates at once

To read several aggregates in one statement, such as the number of the fields of a form and the position of the last one, select the functions of the same names as the [aggregate methods](#aggregates):

```ts
import { count, max } from "kern-orm"

const stats = await db.field
  .where({ formId })
  .select(field => ({
    total: count(),
    lastPosition: max(field.position),
  }))
  .take()
// stats: { total: number; lastPosition: number | null }
```

`count`, `countDistinct`, `min`, `max`, `sum`, `avg`, `every`, and `some` take an expression or a query of one value, such as a column or an aggregate of related records, and give the values that the methods give.
`count()` without an argument counts the rows.

To aggregate only some of the rows, such as to count the published forms beside the total, pass a condition as `filter`:

```ts
const stats = await db.form
  .select(form => ({
    total: count(),
    published: count({ filter: form.published }),
  }))
  .take()
// stats: { total: number; published: number }
```

To join text values, select `stringAgg` with a delimiter, and pass `orderBy` with what the callback of [`orderBy`](./sorting) returns to join them in that order:

```ts
import { count, stringAgg } from "kern-orm"

const summary = await db.field
  .where({ formId })
  .select(field => ({
    total: count(),
    labels: stringAgg(field.label, ", ", { orderBy: field.position }),
  }))
  .take()
// summary: { total: number; labels: string | null }
```

Without `orderBy`, PostgreSQL joins the values in any order.

Each returns an expression with the operators of its type, so pass it to a function or call an operator on it, such as `coalesce(sum(field.position), 0)` or `count().gt(1)`.

Such a query returns one row, so call `take` to get the record instead of an array of it.
`limit` and `offset` apply to this row rather than to the rows that it aggregates, so `limit(10)` beside `count()` counts every row.
To aggregate the rows of a page, call the method, such as `limit(10).count()`.

## Grouping

To get aggregates of groups of rows, such as the number of the submissions of each form, list the columns of the groups in `groupBy` and select the [aggregate functions](#several-aggregates-at-once) beside them:

```ts
import { count } from "kern-orm"

const totals = await db.submission.groupBy("formId").select(submission => ({
  formId: submission.formId,
  submissions: count(),
}))
// totals: { formId: string; submissions: number }[]
```

The query returns one row of each group.
Select only the keys of the groups and aggregates; with the primary key of the table among the keys, select its other columns too.

Each `groupBy` adds its keys after those of earlier calls, such as `groupBy("formId").groupBy("userId")`, which is the same as `groupBy("formId", "userId")`.
`where` chooses the rows to group, wherever you call it.

To aggregate only some rows of each group, such as the recent submissions of each form, pass a condition as `filter` of an aggregate function:

```ts
const totals = await db.submission.groupBy("formId").select(submission => ({
  formId: submission.formId,
  submissions: count(),
  recent: count({ filter: submission.createdAt.gt(weekAgo) }),
}))
// totals: { formId: string; submissions: number; recent: number }[]
```

To join the text values of each group in an order, select [`stringAgg`](#several-aggregates-at-once) with `orderBy`.

Select an aggregate without `filter` directly to get a value that is `null` only when its argument can be: each returned group has at least one row.
This works with `select`, `get`, and `pluck`, whether `groupBy` comes before or after them:

```ts
import { sum } from "kern-orm"

const totals = await db.field.groupBy("formId").select(field => ({
  formId: field.formId,
  positions: sum(field.position),
}))
// totals: { formId: string; positions: number }[]
```

An aggregate of nullable values or with a `filter` can still return `null`.
Use [`coalesce`](./expressions#replacing-null) when you need a fallback, such as `coalesce(sum(field.position, { filter: field.position.gt(0) }), 0)`.
For an expression such as `sum(field.position).gt(0)`, use `coalesce` too if you need a result without `null`.

To aggregate an enclosing query from inside a grouped query, write an explicitly nullable SQL expression, such as ``sql(t.integer.nullable())`sum(${outer.position})` ``.

### Keys of expressions

To group by an expression, such as the day of a submission, select it and take it from the second parameter of the callback of `groupBy`:

```ts
import { count, sql } from "kern-orm"
import * as t from "kern-orm/types"

const days = await db.submission
  .select(submission => ({
    day: sql(t.date)`(${submission.createdAt} at time zone ${timeZone})::date`,
    submissions: count(),
  }))
  .groupBy((submission, selected) => selected.day)
// days: { day: string; submissions: number }[]
```

The callback returns a key or an array of them, each an expression or a [query of one value](./filtering#values-of-other-queries).
The first parameter of the callback holds the columns and the relations of the table; after `pluck` or `get`, the second parameter is the expression of the value.

Use a [SQL query](./sql) for `ROLLUP`, `CUBE`, or `GROUPING SETS`; `groupBy` groups rows by columns or expressions.

A string always names a column of the table, even when a selected field has the same key.

To group by a value of a related record, select its expression, since a field of [related records](./relations) cannot be grouped by:

```ts
const forms = await db.submission
  .select(submission => ({
    formName: submission.form.get("name").expr(),
    submissions: count(),
  }))
  .groupBy((submission, selected) => selected.formName)
// forms: { formName: string; submissions: number }[]
```

Group and sort by a key with values interpolated into it, such as `timeZone` above, or with a query, through its selected field.
PostgreSQL takes another copy of such a key for another expression and rejects the query.
For a condition of such a key alone, call `where` instead, which chooses the rows of the groups.

To read a key with parameters in `having`, create its parameters with [`param`](../types#types-in-queries) and take the key from the second parameter of the callback of `having`:

```ts
import { count, or, param, sql } from "kern-orm"
import * as t from "kern-orm/types"

const days = await db.submission
  .select(submission => ({
    day: sql(t.date)`(${submission.createdAt} at time zone ${param(t.text, timeZone)})::date`,
    submissions: count(),
  }))
  .groupBy((submission, selected) => selected.day)
  .having((submission, selected) => or(selected.day.eq(today), selected.submissions.gt(10)))
```

To sort by such a key without selecting it, create each of its parameters once with `param` and build every copy of the key from them.

A key with a query cannot be read in `having`.

### Filtering groups

To keep only some groups, such as the forms with several submissions, pass a condition of their aggregates to `having`:

```ts
const popular = await db.submission
  .groupBy("formId")
  .having(() => count().gt(1))
  .select(submission => ({
    formId: submission.formId,
    submissions: count(),
  }))
```

To filter by a field that you select, such as the number of the submissions of each form, take it from the second parameter of the callback:

```ts
const popular = await db.submission
  .select(submission => ({
    formId: submission.formId,
    submissions: count(),
  }))
  .groupBy("formId")
  .having((submission, selected) => selected.submissions.gt(1))
```

After `pluck` or `get`, the second parameter is the expression of the value.

`having` takes what [`where`](./filtering) takes, such as an object of the values of a key, and each call adds a condition combined with `AND`.
Call it after `groupBy`.

### Sorting groups

To sort the groups by an aggregate, select it and take it from the second parameter of the callback of [`orderBy`](./sorting#selected-fields):

```ts
import { count, desc } from "kern-orm"

const top = await db.submission
  .groupBy("formId")
  .select(submission => ({
    formId: submission.formId,
    submissions: count(),
  }))
  .orderBy((submission, selected) => desc(selected.submissions))
  .limit(10)
```

To sort by an aggregate that you do not select, return it from the callback, such as `desc(count())`.

`limit`, `offset`, `take`, `get`, `pluck`, `distinct`, `distinctOn`, `map`, and `transform` apply to the groups, and a query of groups nests in a selection, `$select`, and `in` as other queries do.

A query with `groupBy` cannot [lock rows](../locks#locking-rows), and neither `update` nor `delete` can be called on it.

### Related records of a group

To select the related records of a key, such as the form of each group, select the relation:

```ts
const totals = await db.submission.groupBy("formId").select(submission => ({
  form: submission.form.select("name"),
  submissions: count(),
}))
// totals: { form: { name: string }; submissions: number }[]
```

The nested query reads the key `formId`, so PostgreSQL takes it; a relation of another column needs that column among the keys.

### Aggregates of groups

To get the number of the groups, call [`count`](#aggregates) on the query, and to compute another aggregate of the groups, such as the largest number of the submissions of a form, call its method with an aggregate function:

```ts
const formCount = await db.submission.groupBy("formId").count()
// formCount: number

const largest = await db.submission.groupBy("formId").max(() => count())
// largest: number | null
```

`exists` tells whether a group exists, such as `db.submission.groupBy("formId").having(() => count().gt(10)).exists()`.
