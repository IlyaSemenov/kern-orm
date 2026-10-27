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

Columns have the operators of their type:

- `isNull` for every type;
- `eq`, `ne`, and `in` for types with SQL `=`: every built-in type except `json` and arrays of it;
- `lt`, `lte`, `gt`, and `gte` for ordered types: numbers, text, `uuid`, dates and times, `inet`, and enums;
- `like` and `ilike` for `text`, `varchar`, and `char`;
- [operators added to a type](../custom-types#operators) with `withOperators`.

Comparison operators take non-null values; `isNull` matches `NULL`.

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

## SQL fragments

For a condition that operators do not cover, write it with the `sql` template; interpolated values become query parameters:

```ts
import { sql } from "kern-orm"

await db.form.where(form => sql`length(${form.name}) > ${10}`).select("id")
```

A fragment built outside `where`, such as in a variable, needs `sql<boolean>` to be a condition:

```ts
const longName = sql<boolean>`length(name) > 10`
```

A type argument exists only in TypeScript, so such a fragment has only `eq`, `ne`, `in`, and `isNull`.

For the operators of a type, build the fragment with a type from `kern-orm/types`.
The fragment then also encodes compared values with that type.
The type adds no SQL cast:

```ts
import * as t from "kern-orm/types"

await db.form.where(form => sql(t.text)`lower(${form.name})`.like("draft%")).select("id")
```

## Reusable filters

To reuse a condition in queries of a table, define it with `defineFilter`:

```ts
import { defineFilter, or } from "kern-orm"

const publishedOrSurvey = defineFilter(db.form, form =>
  or({ published: true }, form.name.ilike("%survey%")),
)

await db.form.where(publishedOrSurvey).select("id")
```

When the code that defines a filter has no `Db`, define it with a table of the schema, such as `schema.form`, or with `form` itself as returned by `defineTable`.
