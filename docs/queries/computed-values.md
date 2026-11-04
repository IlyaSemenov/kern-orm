# Computed Values

To compute a value from columns and other queries, such as a fallback for `NULL`, the largest of several values, or a value chosen by conditions, call a function of `kern-orm` in the callback of a query.
Use its result as you use a column: select it, filter and sort by it, or pass it to an aggregate or an update.

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

A [`sql` fragment](./filtering#sql-fragments) needs a type to come first, such as ``coalesce(sql(t.integer)`length(${form.hint})`, 0)``.

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

To select a constant, such as a label identifying the source of each record, pass its type and the value to `param`:

```ts
import { param } from "kern-orm"
import * as t from "kern-orm/types"

const forms = await db.form.select(form => ({
  id: form.id,
  source: param(t.text, "form"),
}))
// forms: { id: string; source: string }[]
```

The functions take plain values without it, but a plain array leaves `null` in the type of the result.
Pass the array through `param` when the result must not be `null`, such as `coalesce(form.tags, param(t.array(t.text), []))`.

For a constant condition, use [`TRUE` and `FALSE`](./filtering#combining-conditions).
