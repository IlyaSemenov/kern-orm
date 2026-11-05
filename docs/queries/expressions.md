# Expressions

To compute a value from columns and other queries, such as a fallback for `NULL`, the largest of several values, or a value chosen by conditions, call a function of `kern-orm` in the callback of a query.
Use the resulting expression as you use a column: select it, filter and sort by it, or pass it to an aggregate or an update.
To use one expression in several queries, [define it once](#reusable-expressions).

To change the case of text or get its length, call an [operator](./operators) of the column instead.
To combine conditions, call [`and`, `or`, and `not`](./filtering#combining-conditions), and to write what no function or operator covers, use a [`sql` fragment](./filtering#sql-fragments).

## Replacing NULL

To get another value instead of `NULL`, such as a placeholder for a field without a hint, pass the expression and the fallback to `coalesce`:

```ts
import { coalesce } from "kern-orm"

const fields = await db.field.select(field => ({
  label: field.label,
  hint: coalesce(field.hint, "No hint"),
}))
// fields: { label: string; hint: string }[]
```

It gives the first of its values other than `NULL`, so it takes several fallbacks.
Each of them is a plain value, an expression, or a [query of one value](./filtering#values-of-other-queries).

A query can come first too, such as an [aggregate of related records](./relations#aggregates-of-related-records):

```ts
const forms = await db.form.select(form => ({
  name: form.name,
  lastPosition: coalesce(form.fields.max("position"), 0),
}))
// forms: { name: string; lastPosition: number }[]
```

A query without a row gives `NULL` here, so the function replaces a missing row too.
To keep a missing row missing, call the [method `coalesce`](./selecting#one-value) of the query instead.

## Largest and smallest values

To take the largest of several values, such as the time of the last change of a form or of its fields, pass them to `greatest`; `least` takes the smallest one:

```ts
import { greatest } from "kern-orm"

const forms = await db.form.select(form => ({
  name: form.name,
  lastChange: greatest(form.updatedAt, form.fields.max("updatedAt")),
}))
// forms: { name: string; lastChange: string }[]
```

They skip `NULL`, so a form without fields still has its own time; the result is `NULL` only when all the values are.

## Type of the result

Pass an expression or a query first: its type reads the result and gives it its operators, and plain values among the others are encoded with it:

```ts
await db.form.where(form => coalesce(form.fields.max("position"), 0).gt(3)).select("id")
```

A [`sql` fragment](./filtering#sql-fragments) needs a type to come first, such as ``coalesce(sql(t.integer)`array_length(${form.tags}, 1)`, 0)``.

PostgreSQL computes the result in the wider of the types of the values, so pass the wider one first when they have different formats, such as a `timestamptz` before a `timestamp`.

## Values by conditions

To choose a value by conditions, such as a weight for the label of a field, pass its type, the branches, and the value for other cases to `caseWhen`:

```ts
import { caseWhen } from "kern-orm"
import * as t from "kern-orm/types"

const fields = await db.field.select(field => ({
  label: field.label,
  weight: caseWhen(
    t.integer,
    [
      [field.label.eq("Name"), 100],
      [field.label.eq("Email"), 50],
    ],
    0,
  ),
}))
// fields: { label: string; weight: number }[]
```

The first branch whose condition holds gives the value.
Without the last argument, the value is `NULL` when no condition holds.

A condition is an expression or a [query of one Boolean value](./filtering#related-records), such as of `exists`.
A value is a plain value of the type, `null`, an expression, or a query of one value.

The type reads the result and gives it its operators, and plain values are encoded with it.

Combine it with the other functions and aggregates, such as to take the largest weight of the fields of a form:

```ts
const forms = await db.form.select(form => ({
  name: form.name,
  weight: coalesce(
    form.fields.max(field => caseWhen(t.integer, [[field.label.eq("Name"), 100]], 50)),
    0,
  ),
}))
// forms: { name: string; weight: number }[]
```

## Constant values

To select a constant, such as a label identifying the source of each record, pass it to [`literal`](./selecting#values-from-code), which leaves it out of the SQL statement.

Operators and functions take plain values directly, such as `form.name.eq("Untitled")`, but a plain array leaves `null` in the type of the result.
When the result must not be `null`, pass the type and the array to `param`:

```ts
import { coalesce, param } from "kern-orm"
import * as t from "kern-orm/types"

const forms = await db.form.select(form => ({
  id: form.id,
  tags: coalesce(form.tags, param(t.array(t.text), [])),
}))
// forms: { id: string; tags: string[] }[]
```

For a constant condition, use [`TRUE` and `FALSE`](./filtering#combining-conditions).

## Reusable expressions

To use one expression in several queries, such as whether a form has a field with a label, define it with `defineExpression` and call it with the columns of the query and its arguments:

```ts
import { defineExpression } from "kern-orm"

const hasField = defineExpression(db.form, (form, label: string) =>
  form.fields.where({ label }).exists(),
)

const forms = await db.form
  .where(form => hasField(form, "Email"))
  .select(form => ({
    id: form.id,
    hasPhone: hasField(form, "Phone"),
  }))
// forms: { id: string; hasPhone: boolean }[]
```

Call it wherever a callback of a query takes an expression, such as in `orderBy`, `get`, an aggregate, `update`, `or`, or another reusable expression.
Pass an expression without further parameters directly, such as `db.form.where(hasFields)`.

Write conditions with column operators, such as `form.published.eq(true)`.
To use an object of column values, call [`matches`](./filtering#combining-conditions), such as `matches(form, { published: true })`.

To accept a value or a column of another query as an argument, type the parameter as both, such as `label: string | Expression<string>`.

When the code that defines an expression has no `Db`, such as with dependency injection or in code [shared by several Dbs](../multiple-schemas#shared-code), define it with a table of the schema, such as `schema.form`.

To call an expression in queries of schemas that do not share the relations of the table, define it with `form` itself as returned by `defineTable`; it then receives only the columns:

```ts
const isSurvey = defineExpression(form, form => form.name.ilike("%survey%"))

await tenantDb.form.where(isSurvey).select("id")
await saasDb.form.where(isSurvey).select("id")
```
