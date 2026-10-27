# Sorting and Pagination

To get rows in order, such as the fields of a form by position, list the columns in `orderBy`:

```ts
const fields = await db.field.where({ formId }).orderBy("position").select("id", "label")
```

Columns sort in ascending order.
To sort in another direction, pass an object of columns with their directions:

```ts
const forms = await db.form.orderBy({ published: "desc", name: "asc" }).select("id", "name")
```

A direction is `"asc"` or `"desc"`, optionally with the placement of `NULL`, such as `"desc nulls last"`.
Without it, `NULL` comes last in ascending order and first in descending order.

Column keys and objects can be mixed, such as `orderBy({ published: "desc" }, "name")`, and each `orderBy` adds its columns after those of earlier calls.

The column and the direction can come from variables, such as the sort of a list that the user chose:

```ts
const forms = await db.form.orderBy({ [sort.column]: sort.direction }, "id").select("id", "name")
```

## Expressions

To sort by expressions, such as the length of a name, pass a callback that returns one or an array of them:

```ts
import { desc, sql } from "kern-orm"

const forms = await db.form
  .orderBy(form => [desc(sql`length(${form.name})`), form.name])
  .select("id", "name")
```

An expression sorts in ascending order.
Wrap it in `desc` to sort in descending order, or in `orderBy` with a direction, such as `orderBy(form.name, "desc nulls last")`.

## Selected fields

To sort by a field you select, such as a computed score, take it from the second parameter of the callback:

```ts
import { desc, sql } from "kern-orm"
import * as t from "kern-orm/types"

const forms = await db.form
  .select("id", "name")
  .select(form => ({
    score: sql(t.real)`similarity(${form.name}, ${search})`,
  }))
  .orderBy((form, selected) => desc(selected.score))
```

The rows are sorted by the same values that the records get.

After `pluck` or `get`, the second parameter is the expression of the value.

## Pagination

To get one page of rows, call `limit` and `offset` after sorting:

```ts
const page = await db.form.orderBy("name", "id").limit(20).offset(40).select("id", "name")
```

Sort by columns that tell every row apart, such as `id` last, so that pages neither repeat nor skip rows.

To get the first row in order, call [`take`](./selecting#one-row) after sorting; with `offset` before it, `take` gets the row at that position:

```ts
const second = await db.form.orderBy("name", "id").offset(1).select("id", "name").take()
```

To sort and paginate the related records of each row, see [Related Records](./relations#sorting-and-pagination).
