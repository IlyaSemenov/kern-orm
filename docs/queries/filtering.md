# Filtering

To find records whose columns equal given values, pass an object of the values to `where`:

```ts
await db.form.where({ published: true, name: "Survey" }).select("id")
```

Each `where` adds a condition combined with `AND` with the previous ones.

To find records where a column is `NULL`, pass `null` as its value.
A `json` column can only be compared with `null` this way.

## Operators

For conditions other than equality, pass `where` a callback that receives the columns of the query and returns a condition built with their operators:

```ts
await db.form.where(form => form.name.ilike("draft%")).select("id")
```

Columns have the [operators](./operators) of their type.

## Combining conditions

Combine conditions with `and`, `or`, and `not`:

```ts
import { not, or } from "kern-orm"

await db.form
  .where(form => or({ published: true }, form.id.in(draftIds)))
  .where(form => not(form.name.ilike("draft%")))
  .select("id")

await db.form.where(or({ published: true }, { name: "Survey" })).select("id")
```

They also take objects of column values, which match the columns of the query like an object passed to `where`.

To include a condition only in some cases, such as to also show drafts to an administrator, pass `FALSE` in the other case:

```ts
import { FALSE, or } from "kern-orm"

await db.form
  .where(form => or({ published: true }, isAdmin ? form.name.ilike("draft%") : FALSE))
  .select("id")
```

Pass `TRUE` in the same way for a branch of `and`.
To add a whole clause only in some cases, use [`use`](./composing).

To use an object of column values outside `where`, such as to select whether a record matches it, pass it to `matches` with the columns of the callback:

```ts
import { matches } from "kern-orm"

const forms = await db.form.select(form => ({
  id: form.id,
  isPublishedSurvey: matches(form, { name: "Survey", published: true }),
}))
// forms: { id: string; isPublishedSurvey: boolean }[]
```

## Related records

To find records that have related records, such as the forms that have fields, call `exists` on the [relation](../schemas#relations) in the callback of `where`:

```ts
await db.form.where(form => form.fields.exists()).select("id")
```

The callback receives the relations of the table beside its columns.
Refine the query of a relation to check only some of its records, and negate the condition with `not` to find records without them:

```ts
import { not } from "kern-orm"

const formsWithEmail = await db.form
  .where(form => form.fields.where({ label: "Email" }).exists())
  .select("id")

const emptyForms = await db.form.where(form => not(form.fields.exists())).select("id")
```

Combine such a condition with others in `and`, `or`, and `not`, such as `or({ published: true }, form.fields.exists())`.

`exists` also checks the rows of any other query, such as one that a [helper](./composing#helpers) prepares, or one of a table that the schema does not relate:

```ts
await db.form
  .where(form => db.submission.where(submission => submission.formId.eq(form.id)).exists())
  .select("id")
```

Start such a query from the same `Db` as the query that it filters.

A condition can also be another query of one Boolean value, such as [`some`](./selecting#aggregates) of the related records, or `get` of a column of a related record, such as `field => field.form.get("published")`.

## Values of other queries

To compare a column with a value that another query gives, such as to find the fields of the form named "Feedback" in one statement, pass the query in place of the value:

```ts
await db.field.where({ formId: db.form.where({ name: "Feedback" }).get("id") }).select("id")
```

The query gives one value, such as of `get` or of an [aggregate](./selecting#aggregates); without a row, it gives `NULL`, which matches no record.
Operators take such a query too, such as to find the last field of each form:

```ts
await db.field
  .where(field => field.position.eq(db.field.where({ formId: field.formId }).max("position")))
  .select("id")
```

To apply an operator to the value of a query, such as to find the forms with more than 3 fields, call `expr` on the query and the operator on its result:

```ts
await db.form.where(form => form.fields.count().expr().gt(3)).select("id")
```

You can use any operator of the type of the value, such as `ilike` for text.

To find records whose column equals any of the values of another query, such as the forms that a user submitted, pass a query of `pluck` to `in`:

```ts
await db.form
  .where(form => form.id.in(db.submission.where({ userId }).pluck("formId")))
  .select("id")
```

Start the query from the same `Db` as the query that it filters.

A query passed to `in` can also use [`distinct`](./selecting#distinct-rows):

```ts
await db.form
  .where(form => form.id.in(db.submission.where({ userId }).pluck("formId").distinct()))
  .select("id")
```

## SQL fragments

For a condition that operators do not cover, write it with the `sql` template; interpolated values become query parameters:

```ts
import { sql } from "kern-orm"

await db.form.where(form => sql`${form.name} ~ ${"^draft [0-9]+$"}`).select("id")
```

A fragment built outside `where`, such as in a variable, needs `sql<boolean>` to be a condition:

```ts
const numberedDraft = sql<boolean>`name ~ '^draft [0-9]+$'`
```

A type argument exists only in TypeScript, so such a fragment has only `eq`, `ne`, `in`, and `isNull`.

A query interpolated into a fragment becomes a subquery in parentheses, or its value for a query of one value, such as of an [aggregate](./selecting#aggregates), as in [SQL statements](./sql#queries-in-statements).

To write SQL that reads a table directly, such as to pick a random sample of about 1% of the submissions, interpolate its table of `db`, which becomes its name:

```ts
await db.submission
  .where(
    submission =>
      sql`${submission.id} IN (SELECT id FROM ${db.submission} TABLESAMPLE BERNOULLI (1))`,
  )
  .select("id")
```

For the operators of a type, build the fragment with a type from `kern-orm/types`.
The fragment then also encodes compared values with that type.
The type adds no SQL cast:

```ts
import * as t from "kern-orm/types"

await db.field
  .where(field => sql(t.text)`concat_ws(' ', ${field.label}, ${field.hint})`.ilike("%email%"))
  .select("id")
```

## Reusable conditions

To reuse a condition in queries of a table, define it with [`defineExpression`](./expressions#reusable-expressions), which also takes arguments and can be selected:

```ts
import { defineExpression, matches, or } from "kern-orm"

const publishedOrSurvey = defineExpression(db.form, form =>
  or(matches(form, { published: true }), form.name.ilike("%survey%")),
)

await db.form.where(publishedOrSurvey).select("id")
```
