# Grouping

To get aggregates of groups of rows, such as the number of the submissions of each form, list the columns of the groups in `groupBy` and select the [aggregate functions](./selecting#several-aggregates-at-once) beside them:

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

`sum` and the other aggregates keep `null` in their types in a group too.
To remove it, pass them to [`coalesce`](./expressions#replacing-null), such as `coalesce(sum(field.position), 0)`.

## Keys of expressions

To group by an expression, such as the day of a submission, select it and take it from the second parameter of the callback of `groupBy`:

```ts
import { count, sql } from "kern-orm"
import * as t from "kern-orm/types"

const days = await db.submission
  .select(submission => ({
    day: sql(t.text)`(${submission.createdAt} at time zone ${timeZone})::date::text`,
    submissions: count(),
  }))
  .groupBy((submission, selected) => selected.day)
// days: { day: string; submissions: number }[]
```

The callback returns a key or an array of them, each an expression or a [query of one value](./filtering#values-of-other-queries).
The first parameter of the callback holds the columns and the relations of the table; after `pluck` or `get`, the second parameter is the expression of the value.

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

To read a key with parameters in `having`, or to sort by it without selecting it, create each of its parameters once with [`param`](../types#types-in-queries) and build every copy of the key from them:

```ts
import { count, or, param, sql } from "kern-orm"
import * as t from "kern-orm/types"

const zone = param(t.text, timeZone)

const days = await db.submission
  .select(submission => ({
    day: sql(t.text)`(${submission.createdAt} at time zone ${zone})::date::text`,
    submissions: count(),
  }))
  .groupBy((submission, selected) => selected.day)
  .having(submission =>
    or(
      sql(t.text)`(${submission.createdAt} at time zone ${zone})::date::text`.eq(today),
      count().gt(10),
    ),
  )
```

A key with a query cannot be read in `having`.

## Filtering groups

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

`having` takes what [`where`](./filtering) takes, such as an object of the values of a key, and each call adds a condition combined with `AND`.
Call it after `groupBy`.

## Sorting groups

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

`limit`, `offset`, `take`, `get`, `pluck`, `distinct`, `map`, and `transform` apply to the groups, and a query of groups nests in a selection, `$select`, and `in` as other queries do.

A query with `groupBy` cannot [lock rows](../transactions#locking-rows), and neither `update` nor `delete` can be called on it.

## Related records of a group

To select the related records of a key, such as the form of each group, select the relation:

```ts
const totals = await db.submission.groupBy("formId").select(submission => ({
  form: submission.form.select("name"),
  submissions: count(),
}))
// totals: { form: { name: string }; submissions: number }[]
```

The nested query reads the key `formId`, so PostgreSQL takes it; a relation of another column needs that column among the keys.

## Aggregates of groups

To get the number of the groups, call [`count`](./selecting#aggregates) on the query, and to compute another aggregate of the groups, such as the largest number of the submissions of a form, call its method with an aggregate function:

```ts
const formCount = await db.submission.groupBy("formId").count()
// formCount: number

const largest = await db.submission.groupBy("formId").max(() => count())
// largest: number | null
```

`exists` tells whether a group exists, such as `db.submission.groupBy("formId").having(() => count().gt(10)).exists()`.
